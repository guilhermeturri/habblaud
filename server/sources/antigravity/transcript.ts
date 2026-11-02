// Leitura dos metadados e transcripts do Google Antigravity:
// 1. conversation_summaries.db (SQLite em modo WAL, lido de uma cópia temporária via node:sqlite): título, workspace_uris (cwd),
//    status (CASCADE_RUN_STATUS_RUNNING / IDLE), not_fully_idle, parent_conversation_id, nesting_depth, agent_name;
// 2. annotations/<id>.pbtxt e history.jsonl: fallback de título e pasta de trabalho;
// 3. brain/<id>/.system_generated/logs/transcript.jsonl: passos incrementais (USER_INPUT, PLANNER_RESPONSE, GENERIC,
//    SYSTEM_MESSAGE), chamadas de ferramentas, pensamentos, tokens e erros.
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describePrompt, describeTool, maskSecrets, SPECIAL, truncate, type ActivityDescription } from '../../../shared/activity';
import { tr } from '../../../shared/i18n';
import type { Activity, AgentStats } from '../../../shared/types';
import { LineBuffer, warnOversizedLine } from '../tail';

const MAX_RECENT = 30;
const MAX_HISTORY = 200;

export interface AntigravitySummaryRow {
  conversationId: string;
  title?: string;
  preview?: string;
  stepCount: number;
  lastModifiedAt: number;
  lastUserInputAt: number;
  cwd?: string;
  status: string;
  agentName?: string;
  parentConversationId?: string;
  nestingDepth: number;
  notFullyIdle: boolean;
  killed: boolean;
}

export interface AntigravityTranscriptState {
  sessionId?: string;
  cwd?: string;
  title?: string;
  model?: string;
  parentSessionId?: string;
  subagentRole?: string;
  lastPrompt?: string;
  firstAt?: number;
  lastAt?: number;
  seq: number;
  /** true quando o último passo do modelo terminou sem chamadas de ferramentas pendentes. */
  idle: boolean;
  /** Quantidade de ferramentas chamadas no último PLANNER_RESPONSE que ainda aguardam GENERIC. */
  pendingToolResults: number;
  /** Nome da última ferramenta chamada (para reportar falha se o GENERIC vier com status ERROR). */
  lastToolName?: string;
  /** Subagentes criados por invoke_subagent nesta conversa: conversationId -> { role, typeName }. */
  spawnedSubagents: Map<string, { role?: string; typeName?: string }>;
  stats: AgentStats;
  activity?: Activity;
  recent: Activity[];
  history: Activity[];
}

export function createAntigravityState(): AntigravityTranscriptState {
  return {
    seq: 0,
    idle: false,
    pendingToolResults: 0,
    spawnedSubagents: new Map(),
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    recent: [],
    history: [],
  };
}

/** Desembrulha argumentos serializados como string JSON no transcript.jsonl (ex.: "\"ls -la\""). */
export function unwrapArg(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('{') && s.endsWith('}')) ||
    (s.startsWith('[') && s.endsWith(']')) ||
    s === 'true' ||
    s === 'false' ||
    /^-?\d+(?:\.\d+)?$/.test(s)
  ) {
    try {
      return JSON.parse(s);
    } catch {
      return v;
    }
  }
  return v;
}

export function unwrapArgs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = unwrapArg(v);
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Converte as ferramentas do Antigravity para o formato esperado por describeTool (shared/activity.ts). */
export function mapAntigravityTool(name: string, rawArgs: unknown): { tool: string; input: Record<string, unknown> } {
  const args = unwrapArgs(rawArgs);
  switch (name) {
    case 'run_command':
      return {
        tool: 'Bash',
        input: {
          command: str(args.CommandLine) || str(args.command),
          description: str(args.toolSummary) || str(args.description),
        },
      };
    case 'read_file':
    case 'view_file':
    case 'view_file_outline':
    case 'view_code_item':
      return {
        tool: 'Read',
        input: {
          file_path: str(args.Path) || str(args.AbsolutePath) || str(args.File) || str(args.file_path),
        },
      };
    case 'write_file':
    case 'write_to_file':
      return {
        tool: 'Write',
        input: {
          file_path: str(args.Path) || str(args.TargetFile) || str(args.file_path),
        },
      };
    case 'edit_file':
    case 'replace_file_content':
    case 'multi_replace_file_content':
      return {
        tool: 'Edit',
        input: {
          file_path: str(args.Path) || str(args.TargetFile) || str(args.file_path),
        },
      };
    case 'grep_search':
      return {
        tool: 'Grep',
        input: {
          pattern: str(args.Query) || str(args.pattern),
          path: str(args.SearchPath) || str(args.path),
        },
      };
    case 'find_by_name':
      return {
        tool: 'Glob',
        input: {
          pattern: str(args.Pattern) || str(args.SearchDirectory) || str(args.pattern),
        },
      };
    case 'list_dir':
      return {
        tool: 'LS',
        input: {
          file_path: str(args.DirectoryPath) || str(args.Path) || str(args.path),
        },
      };
    case 'search_web':
      return {
        tool: 'WebSearch',
        input: {
          query: str(args.query) || str(args.Query),
        },
      };
    case 'read_url_content':
      return {
        tool: 'WebFetch',
        input: {
          url: str(args.Url) || str(args.url),
        },
      };
    case 'invoke_subagent':
      return {
        tool: 'Task',
        input: {
          description: str(args.Role) || str(args.TypeName),
          subagent_type: str(args.TypeName),
          prompt: str(args.Prompt),
        },
      };
    case 'send_message':
      return {
        tool: 'SendMessage',
        input: {
          to: str(args.Recipient),
          message: str(args.Message),
        },
      };
    case 'manage_subagents':
      return { tool: 'ListAgents', input: {} };
    case 'manage_task':
      return {
        tool: str(args.Action) === 'kill' ? 'KillShell' : 'TaskOutput',
        input: args,
      };
    case 'ask_question': {
      const rawQs = Array.isArray(args.questions) ? args.questions : [];
      const questions = rawQs.map((q) => {
        if (!q || typeof q !== 'object') return q;
        const qObj = q as Record<string, unknown>;
        const opts = Array.isArray(qObj.options)
          ? qObj.options.map((o) => (typeof o === 'string' ? { label: o } : o))
          : [];
        return {
          question: qObj.question,
          header: qObj.header,
          multiSelect: Boolean(qObj.is_multi_select ?? qObj.multiSelect),
          options: opts,
        };
      });
      return { tool: 'AskUserQuestion', input: { questions } };
    }
    case 'call_mcp_tool': {
      const server = str(args.ServerName) || 'mcp';
      const tool = str(args.ToolName) || 'tool';
      const inner = args.Arguments && typeof args.Arguments === 'object' && !Array.isArray(args.Arguments)
        ? (args.Arguments as Record<string, unknown>)
        : {};
      return { tool: `mcp__${server}__${tool}`, input: inner };
    }
    case 'list_resources':
    case 'read_resource':
      return { tool: 'ReadMcpResourceTool', input: args };
    default:
      return { tool: name, input: args };
  }
}

export function describeAntigravityTool(name: string, rawArgs: unknown): ActivityDescription {
  const { tool, input } = mapAntigravityTool(name, rawArgs);
  return describeTool(tool, input);
}

/** Extrai o texto do usuário de um passo USER_INPUT (<USER_REQUEST>...</USER_REQUEST>). */
export function extractUserPrompt(content: string): string {
  const m = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i.exec(content);
  const raw = m ? m[1] : content;
  return raw.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '').trim();
}

function pushActivity(
  st: AntigravityTranscriptState,
  idPrefix: string,
  desc: ActivityDescription,
  at: number,
  current = true,
  tool?: string,
): Activity {
  const act: Activity = {
    id: `${idPrefix}#${++st.seq}`,
    kind: desc.kind,
    icon: desc.icon,
    text: desc.text,
    ...(desc.detail ? { detail: desc.detail } : {}),
    ...(tool ? { tool } : {}),
    ...(desc.questions ? { questions: desc.questions } : {}),
    at,
  };
  if (current) st.activity = act;
  st.recent.push(act);
  if (st.recent.length > MAX_RECENT) st.recent.shift();
  st.history.push(act);
  if (st.history.length > MAX_HISTORY) st.history.shift();
  return act;
}

function parseTimestamp(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return undefined;
}

/** Processa uma linha de brain/<id>/.system_generated/logs/transcript.jsonl e retorna as atividades geradas. */
export function applyAntigravityLine(
  st: AntigravityTranscriptState,
  line: string,
  fallbackNow = Date.now(),
  idPrefix = 'agy',
): Array<{ activity: Activity; current: boolean }> {
  const emitted: Array<{ activity: Activity; current: boolean }> = [];
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== '{') return emitted;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return emitted;
  }

  const at = parseTimestamp(obj.created_at) ?? st.lastAt ?? fallbackNow;
  if (st.firstAt === undefined || at < st.firstAt) st.firstAt = at;
  if (st.lastAt === undefined || at > st.lastAt) st.lastAt = at;

  const type = str(obj.type);
  const status = str(obj.status);
  const content = typeof obj.content === 'string' ? obj.content : '';

  if (type === 'SYSTEM_MESSAGE') {
    const senderMatch = /\bsender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(content);
    // Só o primeiro passo de um subagente traz a tarefa do pai (sender=<pai>); depois, mensagens de tarefas em
    // segundo plano e de outros agentes também chegam como SYSTEM_MESSAGE e não indicam parentesco.
    const stepIndex = typeof obj.step_index === 'number' ? obj.step_index : Number.POSITIVE_INFINITY;
    if (senderMatch && !st.parentSessionId && stepIndex <= 1) {
      st.parentSessionId = senderMatch[1];
    }
    const taskMatch = /\bcontent=([\s\S]+)$/.exec(content);
    if (taskMatch && !st.lastPrompt) {
      const prompt = taskMatch[1].trim();
      if (prompt) st.lastPrompt = truncate(maskSecrets(prompt.slice(0, 600)), 140);
    }
    return emitted;
  }

  if (type === 'USER_INPUT') {
    const prompt = extractUserPrompt(content);
    st.idle = false;
    st.pendingToolResults = 0;
    if (prompt) {
      st.lastPrompt = truncate(maskSecrets(prompt.slice(0, 600)), 140);
      const act = pushActivity(st, idPrefix, describePrompt(prompt), at, true);
      emitted.push({ activity: act, current: true });
    }
    return emitted;
  }

  if (type === 'PLANNER_RESPONSE') {
    const inTok = (typeof obj.input_tokens === 'number' ? obj.input_tokens : 0) +
      (typeof obj.cache_read_tokens === 'number' ? obj.cache_read_tokens : 0);
    const outTok = typeof obj.output_tokens === 'number' ? obj.output_tokens : 0;
    if (inTok > 0) st.stats.tokensIn += inTok;
    if (outTok > 0) st.stats.tokensOut += outTok;

    const toolCalls = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
    const thinking = typeof obj.thinking === 'string' ? obj.thinking.trim() : '';

    if (toolCalls.length > 0) {
      st.idle = false;
      st.pendingToolResults = toolCalls.length;
      if (thinking) {
        const act = pushActivity(st, idPrefix, SPECIAL.think(), at, false);
        emitted.push({ activity: act, current: false });
      }
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== 'object') continue;
        const call = tc as Record<string, unknown>;
        const rawName = str(call.name);
        if (!rawName) continue;
        st.stats.toolCalls++;
        if (rawName === 'invoke_subagent') st.stats.subagents++;
        const { tool, input } = mapAntigravityTool(rawName, call.args);
        st.lastToolName = tool;
        const desc = describeTool(tool, input);
        const act = pushActivity(st, idPrefix, desc, at, true, tool);
        emitted.push({ activity: act, current: true });
      }
    } else {
      st.pendingToolResults = 0;
      st.idle = status === 'DONE' || status === 'ERROR' || status === 'CANCELED';
      if (content.trim()) {
        const act = pushActivity(st, idPrefix, SPECIAL.respond(content.trim()), at, true);
        emitted.push({ activity: act, current: true });
      } else if (thinking) {
        const act = pushActivity(st, idPrefix, SPECIAL.think(), at, true);
        emitted.push({ activity: act, current: true });
      }
    }
    return emitted;
  }

  if (type === 'GENERIC') {
    if (st.pendingToolResults > 0) st.pendingToolResults--;
    if (status === 'ERROR') {
      const act = pushActivity(st, idPrefix, SPECIAL.error(st.lastToolName || 'Tool', content), at, false, st.lastToolName);
      emitted.push({ activity: act, current: false });
    }
    const subMatch = /Created the following subagent:\s*(\{[\s\S]*?\})/i.exec(content);
    if (subMatch) {
      try {
        const subObj = JSON.parse(subMatch[1]) as Record<string, unknown>;
        const subId = str(subObj.conversationId);
        if (subId && !st.spawnedSubagents.has(subId)) {
          st.spawnedSubagents.set(subId, {});
        }
      } catch {
        // Ignora JSON inválido.
      }
    }
    if (!st.cwd) {
      const uriMatch = /file:\/\/(\/[^\s"'\]}>]+)/.exec(content);
      if (uriMatch) {
        try {
          const decoded = fileURLToPath(`file://${uriMatch[1]}`);
          const brainIdx = decoded.indexOf('/.gemini/');
          if (brainIdx < 0) st.cwd = decoded;
        } catch {
          // Ignora URI inválido.
        }
      }
    }
  }
  return emitted;
}

export class AntigravityTranscriptReader {
  readonly state = createAntigravityState();
  private offset = 0;
  private ino = 0;
  private mtimeMs = -1;
  private buf = new LineBuffer();

  constructor(
    readonly filePath: string,
    readonly idPrefix = 'agy',
  ) {}

  updateSync(): Array<{ activity: Activity; current: boolean }> {
    let st;
    try {
      st = statSync(this.filePath);
    } catch {
      return [];
    }
    if (st.ino !== this.ino || st.size < this.offset) {
      this.reset();
      this.ino = st.ino;
    }
    if (st.size === this.offset && st.mtimeMs === this.mtimeMs) return [];
    this.mtimeMs = st.mtimeMs;
    if (st.size === this.offset) return [];

    let subBuf: Buffer;
    try {
      const buf = readFileSync(this.filePath);
      subBuf = buf.subarray(this.offset, st.size);
      this.offset = st.size;
    } catch {
      return [];
    }

    const { lines, discarded } = this.buf.push(subBuf);
    if (discarded > 0) warnOversizedLine(this.filePath);
    const out: Array<{ activity: Activity; current: boolean }> = [];
    for (const line of lines) {
      out.push(...applyAntigravityLine(this.state, line.toString('utf8'), st.mtimeMs, this.idPrefix));
    }
    return out;
  }

  private reset(): void {
    this.offset = 0;
    this.mtimeMs = -1;
    this.buf = new LineBuffer();
    const fresh = createAntigravityState();
    Object.assign(this.state, fresh);
  }
}

/** Decodifica o campo workspace_uris de conversation_summaries.db (ex.: '["file:///Users/..."]'). */
export function parseWorkspaceUris(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && typeof arr[0] === 'string' && arr[0].startsWith('file://')) {
      return fileURLToPath(arr[0]);
    }
  } catch {
    // Tenta extrair direto se não for JSON válido.
  }
  const m = /file:\/\/\/[^\s"',\]]+/.exec(raw);
  if (m) {
    try {
      return fileURLToPath(m[0]);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Lê annotations/<id>.pbtxt (title e last_user_view_time). */
export function readAnnotationPbtxt(pbtxtPath: string): { title?: string; lastViewAt?: number } {
  try {
    const raw = readFileSync(pbtxtPath, 'utf8');
    const titleMatch = /\btitle:\s*"((?:\\.|[^"\\])*)"/.exec(raw);
    const secMatch = /\blast_user_view_time:\s*\{\s*seconds:\s*(\d+)/.exec(raw);
    const title = titleMatch ? titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : undefined;
    const lastViewAt = secMatch ? Number(secMatch[1]) * 1000 : undefined;
    return { ...(title ? { title } : {}), ...(lastViewAt ? { lastViewAt } : {}) };
  } catch {
    return {};
  }
}

interface DbCacheEntry {
  mtimeMs: number;
  size: number;
  rows: Map<string, AntigravitySummaryRow>;
}

const dbCache = new Map<string, DbCacheEntry>();

/** Assinatura (mtime+tamanho) do .db e do -wal: muda a cada escrita do Antigravity, mesmo antes do checkpoint. */
function fileSig(p: string): { mtimeMs: number; size: number } | undefined {
  try {
    const st = statSync(p);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return undefined;
  }
}

/**
 * A base do Antigravity fica em modo WAL (`-wal`/`-shm` ao lado). Abrir o original em somente-leitura perderia o que
 * ainda está só no WAL (e, montado `ro` no Docker, o SQLite nem conseguiria usar o `-shm`). Então copiamos o trio para
 * uma pasta temporária privada e abrimos a cópia: nunca escrevemos na pasta do Antigravity.
 */
function snapshotDb(dbPath: string): string {
  const tmp = join(tmpdir(), `habblaud-agy-${createHash('sha1').update(dbPath).digest('hex').slice(0, 12)}`);
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  const copy = join(tmp, 'conversation_summaries.db');
  for (const ext of ['-wal', '-shm']) rmSync(copy + ext, { force: true });
  copyFileSync(dbPath, copy);
  if (existsSync(dbPath + '-wal')) copyFileSync(dbPath + '-wal', copy + '-wal');
  return copy;
}

export function readConversationSummaries(dir: string): Map<string, AntigravitySummaryRow> {
  const dbPath = join(dir, 'conversation_summaries.db');
  const dbSig = fileSig(dbPath);
  if (!dbSig) return new Map();
  const walSig = fileSig(dbPath + '-wal');
  const st = { mtimeMs: Math.max(dbSig.mtimeMs, walSig?.mtimeMs ?? 0), size: dbSig.size + (walSig?.size ?? 0) };
  const cached = dbCache.get(dbPath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.rows;
  }

  const rows = new Map<string, AntigravitySummaryRow>();
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(snapshotDb(dbPath));
    const stmt = db.prepare(`
      SELECT
        conversation_id,
        title,
        preview,
        step_count,
        last_modified_time,
        last_user_input_time,
        workspace_uris,
        status,
        agent_name,
        parent_conversation_id,
        nesting_depth,
        not_fully_idle,
        killed
      FROM conversation_summaries
      ORDER BY last_modified_time DESC
      LIMIT 250
    `);
    for (const r of stmt.all() as Array<Record<string, unknown>>) {
      const id = str(r.conversation_id);
      if (!id) continue;
      const cwd = parseWorkspaceUris(r.workspace_uris);
      const lastModifiedAt = parseTimestamp(r.last_modified_time) ?? 0;
      const lastUserInputAt = parseTimestamp(r.last_user_input_time) ?? lastModifiedAt;
      rows.set(id, {
        conversationId: id,
        title: str(r.title) || undefined,
        preview: str(r.preview) || undefined,
        stepCount: typeof r.step_count === 'number' ? r.step_count : Number(r.step_count) || 0,
        lastModifiedAt,
        lastUserInputAt,
        cwd,
        status: str(r.status),
        agentName: str(r.agent_name) || undefined,
        parentConversationId: str(r.parent_conversation_id) || undefined,
        nestingDepth: typeof r.nesting_depth === 'number' ? r.nesting_depth : Number(r.nesting_depth) || 0,
        notFullyIdle: Boolean(r.not_fully_idle),
        killed: Boolean(r.killed),
      });
    }
  } catch {
    return cached?.rows ?? new Map();
  } finally {
    try {
      db?.close();
    } catch {
      // Ignora erro ao fechar.
    }
  }

  dbCache.set(dbPath, { mtimeMs: st.mtimeMs, size: st.size, rows });
  return rows;
}

export interface HistoryIndexEntry {
  cwd?: string;
  display?: string;
  timestamp?: number;
}

const historyCache = new Map<string, { mtimeMs: number; size: number; entries: Map<string, HistoryIndexEntry> }>();

export function readHistoryJsonl(dir: string): Map<string, HistoryIndexEntry> {
  const file = join(dir, 'history.jsonl');
  let st;
  try {
    st = statSync(file);
  } catch {
    return new Map();
  }
  const cached = historyCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.entries;

  const entries = new Map<string, HistoryIndexEntry>();
  try {
    const raw = readFileSync(file, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const id = str(obj.conversationId);
        if (!id) continue;
        const workspace = str(obj.workspace);
        const display = str(obj.display);
        const timestamp = typeof obj.timestamp === 'number' ? obj.timestamp : undefined;
        const prev = entries.get(id) ?? {};
        entries.set(id, {
          cwd: workspace || prev.cwd,
          display: prev.display || display,
          timestamp: timestamp ?? prev.timestamp,
        });
      } catch {
        // Ignora linha inválida.
      }
    }
  } catch {
    return cached?.entries ?? new Map();
  }
  historyCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, entries });
  return entries;
}

export function transcriptPathFor(dir: string, conversationId: string): string {
  return join(dir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
}

export function hasTranscriptFile(dir: string, conversationId: string): boolean {
  return existsSync(transcriptPathFor(dir, conversationId));
}

export function fallbackActivity(idPrefix: string, summary: AntigravitySummaryRow): Activity {
  const text = summary.notFullyIdle
    ? tr('Processando no Antigravity')
    : summary.preview
      ? truncate(maskSecrets(summary.preview), 46)
      : tr('Sessão do Antigravity');
  return {
    id: `${idPrefix}#summary:${summary.lastModifiedAt || 0}`,
    kind: summary.notFullyIdle ? 'think' : 'done',
    icon: summary.notFullyIdle ? '🧠' : '✨',
    text,
    at: summary.lastModifiedAt || Date.now(),
  };
}
