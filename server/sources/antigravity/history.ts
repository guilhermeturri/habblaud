// Histórico do terminal do Google Antigravity (HistoryProvider 'antigravity', ver sources/source.ts).
import { realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { RecentSession } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { HISTORY_LIMIT, HISTORY_MAX_AGE_MS } from '../history';
import type { HistoryProvider, HistoryResolveResult } from '../source';
import { encodeCwd } from '../watcher';
import { createAntigravityTerminalParser } from './terminal';
import {
  readAnnotationPbtxt,
  readConversationSummaries,
  readHistoryJsonl,
  transcriptPathFor,
} from './transcript';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AntigravityHistoryAccount {
  id: string;
  dir: string;
}

export interface AntigravityHistoryOptions {
  accounts: () => readonly AntigravityHistoryAccount[];
  openAgentOf: (account: string, sessionId: string) => string | undefined;
  now?: () => number;
  maxAgeMs?: number;
  limit?: number;
}

export class AntigravityHistory implements HistoryProvider {
  readonly provider = 'antigravity' as const;
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private readonly limit: number;

  constructor(private readonly opts: AntigravityHistoryOptions) {
    this.now = opts.now ?? Date.now;
    this.maxAgeMs = opts.maxAgeMs ?? HISTORY_MAX_AGE_MS;
    this.limit = opts.limit ?? HISTORY_LIMIT;
  }

  hasAccount(account: string): boolean {
    return this.opts.accounts().some((a) => a.id === account);
  }

  async list(): Promise<RecentSession[]> {
    const now = this.now();
    const out: RecentSession[] = [];

    for (const acc of this.opts.accounts()) {
      const summaries = readConversationSummaries(acc.dir);
      const historyIdx = readHistoryJsonl(acc.dir);

      for (const [sessionId, row] of summaries) {
        if (row.parentConversationId || row.nestingDepth > 0) continue;
        const tPath = transcriptPathFor(acc.dir, sessionId);
        let st;
        try {
          st = statSync(tPath);
        } catch {
          continue;
        }
        const hist = historyIdx.get(sessionId);
        const annot = readAnnotationPbtxt(join(acc.dir, 'annotations', `${sessionId}.pbtxt`));
        const lastAt = Math.max(row.lastModifiedAt || 0, st.mtimeMs, annot.lastViewAt || 0, hist?.timestamp || 0);
        const agentId = this.opts.openAgentOf(acc.id, sessionId);
        if (!agentId && now - lastAt > this.maxAgeMs) continue;

        const cwd = row.cwd || hist?.cwd;
        const title = row.title || annot.title || hist?.display || row.preview;
        const firstAt = row.lastUserInputAt || hist?.timestamp || lastAt;

        const r: RecentSession = {
          account: acc.id,
          provider: 'antigravity',
          sessionId,
          projectDir: cwd ? encodeCwd(cwd) : 'brain',
          lastAt,
          size: st.size,
          open: Boolean(agentId),
        };
        if (cwd) r.project = cwd;
        if (title) r.title = title;
        if (firstAt) r.firstAt = firstAt;
        if (agentId) r.agentId = agentId;
        out.push(r);
      }
    }

    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, this.limit);
  }

  resolve(account: string, sessionId: string): HistoryResolveResult {
    if (!UUID_RE.test(sessionId)) return { status: 400, error: tr('id de sessão inválido') };
    const acc = this.opts.accounts().find((a) => a.id === account);
    if (!acc) return { status: 404, error: tr('conta desconhecida') };
    let root: string;
    let real: string;
    try {
      root = realpathSync(acc.dir);
      real = realpathSync(transcriptPathFor(acc.dir, sessionId));
    } catch {
      return { status: 404, error: tr('sessão não encontrada') };
    }
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (!real.startsWith(prefix)) return { status: 404, error: tr('sessão não encontrada') };
    return {
      path: real,
      createParser: () => createAntigravityTerminalParser(),
    };
  }
}
