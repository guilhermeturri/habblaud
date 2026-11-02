// Fonte de agentes do Google Antigravity (AgentSource 'antigravity', ver sources/source.ts).
// Observa as sessões abertas de cada conta do Antigravity (~/.gemini/antigravity-cli, ~/.gemini/antigravity,
// ~/.gemini/antigravity-ide) e alimenta o Office; os eventos dos hooks (AntigravityLive, via POST /api/antigravity/events)
// adiantam o estado e as ferramentas em tempo real.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentStats, AgentStatus, SourceInfo } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import type { DetectedAccount } from '../../accounts/detect';
import type { AccountEntry, AccountsService } from '../../accounts/service';
import { errMsg, log } from '../../log';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';
import type { TerminalParser } from '../terminal';
import { detectAntigravityAccounts } from './accounts';
import { AntigravityLive } from './live';
import { createAntigravityTerminalParser } from './terminal';
import {
  AntigravityTranscriptReader,
  fallbackActivity,
  hasTranscriptFile,
  readAnnotationPbtxt,
  readConversationSummaries,
  readHistoryJsonl,
  transcriptPathFor,
  type AntigravitySummaryRow,
} from './transcript';

/** Janela em que uma sessão principal ociosa permanece no escritório após a última atividade/visualização. */
export const OPEN_WINDOW_MS = 2 * 3600_000;
/** Janela em que uma linha em andamento no transcript.jsonl ainda conta como 'working' sem hook. */
export const WORKING_GRACE_MS = 90_000;
/** Quanto tempo um subagente recém-concluído aparece para entregar o resultado. */
export const SUB_DONE_KEEP_MS = 60_000;
const CLOSE_AFTER_MISSING_MS = 2_000;

const MAIN_ROLE = tr('Agente principal (Antigravity)');
const SUB_ROLE = tr('Subagente (Antigravity)');

export function antigravityAgentId(accountId: string, sessionId: string): string {
  return `${accountId}:${sessionId}`;
}

export interface AntigravitySourceOptions {
  accounts: AccountsService;
  office: Office;
  dirs: string[];
  live?: AntigravityLive;
  now?: () => number;
  pollMs?: number;
  openWindowMs?: number;
}

interface TrackedSession {
  id: string;
  accountId: string;
  dir: string;
  sessionId: string;
  kind: 'main' | 'sub';
  parentId?: string;
  inOffice: boolean;
  subDone: boolean;
  status: AgentStatus;
  reader?: AntigravityTranscriptReader;
  transcriptPath?: string;
  lastSummaryHash?: string;
  lastLiveActId?: string;
  missingSince?: number;
}

export class AntigravitySource implements AgentSource {
  readonly provider = 'antigravity' as const;
  private entries: readonly AccountEntry[] = [];
  private detected: DetectedAccount[] = [];
  private tracked = new Map<string, TrackedSession>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly openWindowMs: number;

  constructor(private readonly opts: AntigravitySourceOptions) {
    this.now = opts.now ?? Date.now;
    this.openWindowMs = opts.openWindowMs ?? OPEN_WINDOW_MS;
    const existing = opts.accounts.allEntries().filter((e) => e.provider !== 'antigravity');
    this.detected = detectAntigravityAccounts(opts.dirs, {
      taken: {
        shorts: existing.map((e) => e.detected.short),
        colors: existing.map((e) => e.detected.color),
      },
    });
    this.entries = this.opts.accounts.setProviderAccounts(
      'antigravity',
      this.opts.dirs.map((dir, i) => ({ dir, detected: this.detected[i] })),
    );
  }

  accountEntries(): readonly AccountEntry[] {
    return this.entries;
  }

  start(): void {
    this.boot();
    this.timer = setInterval(() => this.safePoll(), this.opts.pollMs ?? 1_500);
    this.timer.unref?.();
  }

  boot(): void {
    this.opts.office.beginBoot();
    try {
      this.poll(true);
    } finally {
      this.opts.office.endBoot();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sources(): SourceInfo[] {
    return this.entries.map((acc) => {
      let sessions = 0;
      for (const t of this.tracked.values()) {
        if (t.accountId === acc.id && t.kind === 'main' && t.inOffice) sessions++;
      }
      return {
        label: acc.id,
        provider: 'antigravity',
        path: acc.detected.configDir,
        sessions,
        ok: existsSync(acc.dir),
      };
    });
  }

  transcriptPathOf(agentId: string): string | undefined {
    const t = this.tracked.get(agentId);
    if (!t || !t.inOffice || !t.transcriptPath) return undefined;
    return existsSync(t.transcriptPath) ? t.transcriptPath : undefined;
  }

  terminalParser(agentId: string): TerminalParser | undefined {
    return this.tracked.has(agentId) ? createAntigravityTerminalParser() : undefined;
  }

  private safePoll(): void {
    try {
      this.poll(false);
    } catch (err) {
      log.warnOnce(`antigravity-poll:${errMsg(err)}`, tr('Antigravity: falha no ciclo de leitura: {0}', [errMsg(err)]));
    }
  }

  poll(boot = false): void {
    const now = this.now();
    const seen = new Set<string>();

    for (const acc of this.entries) {
      const summaries = readConversationSummaries(acc.dir);
      const historyIdx = readHistoryJsonl(acc.dir);
      const candidateIds = new Set<string>(summaries.keys());

      try {
        const brainDir = join(acc.dir, 'brain');
        for (const entry of readdirSync(brainDir)) {
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry)) {
            candidateIds.add(entry);
          }
        }
      } catch {
        // Sem pasta brain/.
      }

      for (const liveSess of this.opts.live?.activeSessions(now) ?? []) {
        if (liveSess.transcriptPath?.startsWith(acc.dir) || this.entries.length === 1) {
          candidateIds.add(liveSess.sessionId);
        }
      }

      // Ordena primeiro os principais e depois os subagentes (para o pai já existir no Office quando o filho entrar).
      const ordered = [...candidateIds].sort((a, b) => {
        const da = summaries.get(a)?.nestingDepth ?? 0;
        const db = summaries.get(b)?.nestingDepth ?? 0;
        return da - db;
      });

      for (const sessionId of ordered) {
        const summary = summaries.get(sessionId);
        const live = this.opts.live?.get(sessionId, now);
        const tPath = transcriptPathFor(acc.dir, sessionId);
        const tStat = safeStat(tPath);
        const annot = readAnnotationPbtxt(join(acc.dir, 'annotations', `${sessionId}.pbtxt`));
        const hist = historyIdx.get(sessionId);

        const lastTouchAt = Math.max(
          summary?.lastModifiedAt ?? 0,
          summary?.lastUserInputAt ?? 0,
          tStat?.mtimeMs ?? 0,
          annot.lastViewAt ?? 0,
          hist?.timestamp ?? 0,
          live?.lastSeenAt ?? 0,
        );

        const isRunningInDb = summary?.notFullyIdle === true || summary?.status === 'CASCADE_RUN_STATUS_RUNNING';
        const isLiveWorking = live?.status === 'working';
        const isRecent = lastTouchAt > 0 && now - lastTouchAt <= this.openWindowMs;

        if (!isRunningInDb && !isLiveWorking && !live && !isRecent) {
          continue;
        }

        const id = antigravityAgentId(acc.id, sessionId);
        let t = this.tracked.get(id);
        if (!t) {
          t = {
            id,
            accountId: acc.id,
            dir: acc.dir,
            sessionId,
            kind: 'main',
            inOffice: false,
            subDone: false,
            status: 'idle',
            transcriptPath: tPath,
          };
          this.tracked.set(id, t);
        }

        const newActs = tStat
          ? (t.reader ??= new AntigravityTranscriptReader(tPath, id)).updateSync()
          : [];
        const st = t.reader?.state;

        // A base é a fonte de verdade do parentesco; o transcript só vale quando a sessão ainda não está na base.
        const parentCandidate = summary ? summary.parentConversationId : st?.parentSessionId;
        const rawParentId = parentCandidate && parentCandidate !== sessionId ? parentCandidate : undefined;
        const isSub = Boolean(rawParentId) || (summary?.nestingDepth ?? 0) > 0;
        const rootParentSessionId = rawParentId ? resolveRootParent(rawParentId, summaries) : undefined;
        const parentAgentId = rootParentSessionId ? antigravityAgentId(acc.id, rootParentSessionId) : undefined;

        t.kind = isSub ? 'sub' : 'main';
        t.parentId = parentAgentId;

        const cwd =
          live?.cwd ||
          summary?.cwd ||
          hist?.cwd ||
          st?.cwd;
        if (!cwd && !isSub) continue;

        const transcriptWorking = Boolean(st && !st.idle && tStat && now - tStat.mtimeMs <= WORKING_GRACE_MS);
        const working = Boolean(isLiveWorking || isRunningInDb || transcriptWorking);

        if (isSub && !working && !t.inOffice) {
          const doneAge = now - lastTouchAt;
          if (summary?.killed || doneAge > SUB_DONE_KEEP_MS) continue;
        }

        const startedAt = st?.firstAt || hist?.timestamp || summary?.lastUserInputAt || lastTouchAt || now;
        const lastAt = Math.max(st?.lastAt ?? 0, lastTouchAt) || now;
        const title =
          summary?.title ||
          annot.title ||
          st?.title ||
          st?.lastPrompt ||
          hist?.display ||
          summary?.preview;

        if (!t.inOffice) {
          if (isSub) {
            if (!parentAgentId) continue;
            const role = summary?.agentName ? `${summary.agentName} (Antigravity)` : SUB_ROLE;
            const added = this.opts.office.addSub({
              id,
              parentId: parentAgentId,
              sessionId,
              role,
              ...(title ? { title } : {}),
              startedAt,
              background: true,
            });
            if (!added) continue;
            t.inOffice = true;
            t.status = 'working';
          } else {
            const initialStatus: AgentStatus = working ? 'working' : 'idle';
            this.opts.office.addMain({
              id,
              sessionId,
              account: acc.id,
              provider: 'antigravity',
              cwd: cwd!,
              role: MAIN_ROLE,
              status: initialStatus,
              startedAt,
            });
            t.inOffice = true;
            t.status = initialStatus;
          }
        }

        seen.add(id);
        delete t.missingSince;

        // Emite atividades novas do transcript.jsonl.
        for (const item of newActs) {
          this.opts.office.addActivity(id, item.activity, item.current, { feed: !boot });
        }

        // Atividade ao vivo do hook (se mais nova que o transcript).
        const liveAct = live?.activeTool?.activity ?? live?.activity;
        if (liveAct && liveAct.id !== t.lastLiveActId) {
          t.lastLiveActId = liveAct.id;
          this.opts.office.addActivity(id, liveAct, true, { feed: !boot });
        }

        // Se não há transcript.jsonl (ex.: sessão antiga do app Desktop), aplica atividade do resumo.
        if (!tStat && summary) {
          const hash = `${summary.lastModifiedAt}:${summary.notFullyIdle}:${summary.preview ?? ''}`;
          if (hash !== t.lastSummaryHash) {
            t.lastSummaryHash = hash;
            this.opts.office.addActivity(id, fallbackActivity(id, summary), true, { feed: !boot });
          }
        }

        const stats: AgentStats = st
          ? { ...st.stats }
          : {
              toolCalls: summary?.stepCount ?? 0,
              tokensIn: 0,
              tokensOut: 0,
              subagents: 0,
            };

        this.opts.office.applyTranscript(id, {
          ...(title ? { title } : {}),
          tasks: [],
          stats,
          ...(live?.model || st?.model ? { model: live?.model || st?.model } : {}),
          firstAt: startedAt,
          lastAt,
        });

        if (isSub) {
          if (!working && !t.subDone) {
            t.subDone = true;
            t.status = 'done';
            this.opts.office.completeSub(id, { notify: !boot });
          } else if (working && t.subDone) {
            t.subDone = false;
            t.status = 'working';
            this.opts.office.reactivateSub(id);
          }
        } else {
          const nextStatus: AgentStatus = working ? 'working' : 'idle';
          if (t.status !== nextStatus) {
            t.status = nextStatus;
            this.opts.office.setStatus(id, nextStatus);
          }
          if (nextStatus === 'working') {
            this.opts.office.fillWorkingActivity(id);
          }
        }
      }
    }

    // Fecha sessões que saíram da janela de atividade.
    for (const [id, t] of [...this.tracked]) {
      if (seen.has(id)) continue;
      t.missingSince ??= now;
      if (now - t.missingSince < CLOSE_AFTER_MISSING_MS) continue;
      if (t.inOffice) {
        if (t.kind === 'sub') {
          if (!t.subDone) this.opts.office.completeSub(id, { notify: false });
        } else {
          this.opts.office.closeMain(id);
        }
      }
      this.tracked.delete(id);
    }
  }
}

function resolveRootParent(parentId: string, summaries: ReadonlyMap<string, AntigravitySummaryRow>): string {
  let cur = parentId;
  const visited = new Set<string>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const row = summaries.get(cur);
    if (!row?.parentConversationId) return cur;
    cur = row.parentConversationId;
  }
  return cur;
}

function safeStat(p: string): { mtimeMs: number; size: number } | undefined {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
}
