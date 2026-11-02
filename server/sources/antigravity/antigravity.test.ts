import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { checkHooksJson, mergeHooksJson, removeHooksJson } from '../../../scripts/antigravity-install';
import { AccountsService } from '../../accounts/service';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { detectAntigravityAccounts, discoverAntigravityDirs, planAntigravityMounts } from './accounts';
import { AntigravityLive } from './live';
import { AntigravitySource } from './source';
import { createAntigravityTerminalParser } from './terminal';
import {
  applyAntigravityLine,
  createAntigravityState,
  extractUserPrompt,
  mapAntigravityTool,
  parseWorkspaceUris,
  readConversationSummaries,
  unwrapArgs,
} from './transcript';

describe('antigravity transcript & tool mapping', () => {
  it('unwraps JSON-encoded string arguments from transcript.jsonl', () => {
    const raw = {
      CommandLine: '"npm test"',
      WaitMsBeforeAsync: '5000',
      toolSummary: '"Run unit tests"',
    };
    expect(unwrapArgs(raw)).toEqual({
      CommandLine: 'npm test',
      WaitMsBeforeAsync: 5000,
      toolSummary: 'Run unit tests',
    });
  });

  it('maps Antigravity tools to Habblaud tool format', () => {
    expect(
      mapAntigravityTool('run_command', {
        CommandLine: '"git status"',
        toolSummary: '"Check git status"',
      }),
    ).toEqual({
      tool: 'Bash',
      input: { command: 'git status', description: 'Check git status' },
    });

    expect(mapAntigravityTool('read_file', { Path: '"/Users/test/app.ts"' })).toEqual({
      tool: 'Read',
      input: { file_path: '/Users/test/app.ts' },
    });

    expect(
      mapAntigravityTool('ask_question', {
        questions: [{ question: 'Qual opção?', is_multi_select: true, options: ['A', 'B'] }],
      }),
    ).toEqual({
      tool: 'AskUserQuestion',
      input: {
        questions: [
          {
            question: 'Qual opção?',
            header: undefined,
            multiSelect: true,
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
    });
  });

  it('extracts user request from USER_INPUT and strips metadata', () => {
    const content = '<USER_REQUEST>\nAdapta el proyecto para Antigravity\n</USER_REQUEST>\n<ADDITIONAL_METADATA>xyz</ADDITIONAL_METADATA>';
    expect(extractUserPrompt(content)).toBe('Adapta el proyecto para Antigravity');
  });

  it('parses transcript lines and tracks stats, activities, and subagents', () => {
    const st = createAntigravityState();
    applyAntigravityLine(
      st,
      JSON.stringify({
        step_index: 0,
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-02T10:00:00Z',
        content: '<USER_REQUEST>Revisar código</USER_REQUEST>',
      }),
    );
    expect(st.idle).toBe(false);
    expect(st.lastPrompt).toBe('Revisar código');

    applyAntigravityLine(
      st,
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-02T10:00:05Z',
        thinking: 'Analizando archivos...',
        input_tokens: 1200,
        cache_read_tokens: 300,
        output_tokens: 80,
        tool_calls: [
          {
            name: 'read_file',
            args: { Path: '"/Users/test/index.ts"' },
          },
        ],
      }),
    );
    expect(st.stats.toolCalls).toBe(1);
    expect(st.stats.tokensIn).toBe(1500);
    expect(st.stats.tokensOut).toBe(80);
    expect(st.activity?.tool).toBe('Read');

    applyAntigravityLine(
      st,
      JSON.stringify({
        step_index: 2,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-02T10:00:06Z',
        content: 'Created the following subagent:\n{"conversationId": "11111111-2222-3333-4444-555555555555"}',
      }),
    );
    expect(st.spawnedSubagents.has('11111111-2222-3333-4444-555555555555')).toBe(true);
  });

  it('parses workspace_uris from conversation_summaries.db', () => {
    expect(parseWorkspaceUris('["file:///Users/test/My%20Project"]')).toBe('/Users/test/My Project');
  });

  it('only infers the parent from a SYSTEM_MESSAGE in the first steps (not background task notices)', () => {
    const parent = '11111111-2222-3333-4444-555555555555';
    const late = createAntigravityState();
    applyAntigravityLine(late, JSON.stringify({ step_index: 40, type: 'SYSTEM_MESSAGE', content: `sender=${parent} content=done` }));
    expect(late.parentSessionId).toBeUndefined();
    const sub = createAntigravityState();
    applyAntigravityLine(sub, JSON.stringify({ step_index: 0, type: 'SYSTEM_MESSAGE', content: `sender=${parent} content=Investiga X` }));
    expect(sub.parentSessionId).toBe(parent);
  });
});

describe('antigravity terminal parser', () => {
  it('converts transcript.jsonl lines into TerminalEntry items', () => {
    const parser = createAntigravityTerminalParser();
    const u = parser.push(
      JSON.stringify({
        step_index: 0,
        type: 'USER_INPUT',
        created_at: '2026-11-02T10:00:00Z',
        content: '<USER_REQUEST>Hola Antigravity</USER_REQUEST>',
      }),
    );
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ kind: 'user', text: 'Hola Antigravity' });

    const a = parser.push(
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-02T10:00:02Z',
        thinking: 'Pensando...',
        content: 'Voy a revisar.',
        tool_calls: [{ name: 'run_command', args: { CommandLine: '"ls -la"' } }],
      }),
    );
    expect(a.map((e) => e.kind)).toEqual(['thinking', 'assistant', 'tool']);

    const r = parser.push(
      JSON.stringify({
        step_index: 2,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-11-02T10:00:03Z',
        content: 'total 0',
      }),
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'result', text: 'total 0' });
  });
});

describe('antigravity source & sqlite integration', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length) {
      const d = tmpDirs.pop()!;
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('discovers sessions and subagents from conversation_summaries.db and brain/*/transcript.jsonl', () => {
    const root = mkdtempSync(join(tmpdir(), 'habblaud-agy-'));
    tmpDirs.push(root);
    const agyDir = join(root, '.gemini', 'antigravity-cli');
    mkdirSync(agyDir, { recursive: true });

    const dbPath = join(agyDir, 'conversation_summaries.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id text PRIMARY KEY,
        title text NOT NULL DEFAULT "",
        preview text NOT NULL DEFAULT "",
        step_count integer NOT NULL DEFAULT 0,
        last_modified_time datetime NOT NULL,
        last_user_input_time datetime NOT NULL,
        workspace_uris text NOT NULL,
        status text NOT NULL DEFAULT "",
        agent_name text NOT NULL DEFAULT "",
        parent_conversation_id text NOT NULL DEFAULT "",
        nesting_depth integer NOT NULL DEFAULT 0,
        not_fully_idle numeric NOT NULL DEFAULT false,
        killed numeric NOT NULL DEFAULT false
      );
    `);
    const mainId = '74bc2e5b-8df1-4a1d-939f-38ddf884ab9b';
    const subId = '5fbd041d-6f68-4609-8307-afe8ff1c0e3e';
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mainId,
      'Plan Antigravity',
      'Adaptar Habblaud',
      5,
      nowIso,
      nowIso,
      '["file:///Users/test/habblaud"]',
      'CASCADE_RUN_STATUS_RUNNING',
      '',
      '',
      0,
      1,
      0,
    );
    db.prepare(`
      INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      subId,
      'Subagent Research',
      'Researching codebase',
      2,
      nowIso,
      nowIso,
      '["file:///Users/test/habblaud"]',
      'CASCADE_RUN_STATUS_RUNNING',
      'research',
      mainId,
      1,
      1,
      0,
    );
    db.close();

    const logDir = join(agyDir, 'brain', mainId, '.system_generated', 'logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      join(logDir, 'transcript.jsonl'),
      `${JSON.stringify({
        step_index: 0,
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: nowIso,
        content: '<USER_REQUEST>Hola</USER_REQUEST>',
      })}\n`,
    );

    const discovered = discoverAntigravityDirs({}, root);
    expect(discovered).toEqual([agyDir]);
    const mounts = planAntigravityMounts(discovered, detectAntigravityAccounts(discovered));
    expect(mounts).toHaveLength(1);
    expect(mounts[0].mountDir).toBe('/antigravity/antigravity-cli');

    const names = new NameStore(join(root, 'names.json'));
    const accounts = new AccountsService({ dirs: [], home: root, env: {}, onChange: () => {} });
    const office = new Office({
      names,
      version: '1.0.3',
      startedAt: Date.now(),
      accounts: (s) => accounts.list(s),
      sources: () => [],
      accountName: (id) => accounts.find(id)?.detected.name,
      terminal: true,
      permissions: () => new Map(),
      ptys: () => ({ status: { enabled: false }, list: [] }),
      updates: () => ({ state: 'off', available: false }),
      world: () => ({ enabled: false, configured: false, state: 'off' }),
    });

    const live = new AntigravityLive();
    const src = new AntigravitySource({ accounts, office, dirs: [agyDir], live });
    src.boot();

    const list = office.list();
    expect(list).toHaveLength(2);
    const main = list.find((a) => a.kind === 'main');
    const sub = list.find((a) => a.kind === 'sub');
    expect(main).toBeDefined();
    expect(main?.provider).toBe('antigravity');
    expect(main?.status).toBe('working');
    expect(main?.title).toBe('Plan Antigravity');
    expect(sub).toBeDefined();
    expect(sub?.parentId).toBe(main?.id);
    expect(sub?.provider).toBe('antigravity');
  });

  it('reads rows that are still only in the WAL (no checkpoint) and mounts the whole account dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'habblaud-agy-wal-'));
    tmpDirs.push(root);
    const agyDir = join(root, 'antigravity-cli');
    mkdirSync(agyDir, { recursive: true });
    const dbPath = join(agyDir, 'conversation_summaries.db');
    const writer = new DatabaseSync(dbPath);
    try {
      writer.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
        CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text, preview text, step_count integer,
          last_modified_time datetime, last_user_input_time datetime, workspace_uris text, status text, agent_name text,
          parent_conversation_id text, nesting_depth integer, not_fully_idle numeric, killed numeric);`);
      const now = new Date().toISOString();
      writer.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('wal-only', 'Solo en el WAL', '', 1, now, now, '[]', 'CASCADE_RUN_STATUS_RUNNING', '', '', 0, 1, 0);
      expect(existsSync(`${dbPath}-wal`)).toBe(true);
      // O escritor continua aberto: a linha só existe no -wal.
      expect(readConversationSummaries(agyDir).get('wal-only')?.title).toBe('Solo en el WAL');
    } finally {
      writer.close();
    }
    const mounts = planAntigravityMounts([agyDir], detectAntigravityAccounts([agyDir]));
    expect(mounts[0].binds).toEqual([{ source: agyDir, target: mounts[0].mountDir }]);
  });
});

describe('antigravity hooks installer', () => {
  it('merges, checks, and removes Habblaud hooks without touching user hooks', () => {
    const initial = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo hello', timeout: 5 }] }],
      },
    };
    const spec = {
      nodeBin: '/usr/local/bin/node',
      scriptPath: '/Users/test/habblaud/mod/habblaud-antigravity/hook.mjs',
      waitSeconds: 120,
    };
    const merged = mergeHooksJson(initial, spec);
    expect(checkHooksJson(merged).missing).toEqual([]);
    const { next, removed } = removeHooksJson(merged);
    expect(removed).toBe(true);
    expect(checkHooksJson(next).installed).toEqual([]);
    expect((next.hooks as Record<string, unknown[]>).SessionStart).toHaveLength(1);
  });
});
