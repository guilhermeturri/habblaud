// Estado ao vivo das sessões do Google Antigravity, alimentado pelos hooks (~/.gemini/config/hooks.json)
// em POST /api/antigravity/events (SessionStart, PreInvocation, PostInvocation, PreToolUse, PostToolUse, Stop).
import { describePrompt, SPECIAL } from '../../../shared/activity';
import type { Activity } from '../../../shared/types';
import { describeAntigravityTool, mapAntigravityTool } from './transcript';

/** Enquanto o hook falou nos últimos 10 min, a sessão conta como viva e capaz de receber mensagens no próximo turno. */
export const HOOK_PRESENCE_MS = 10 * 60_000;
/** Uma ferramenta em PreToolUse sem PostToolUse expira após 5 min. */
export const TOOL_LIVE_MS = 5 * 60_000;

export interface AntigravityLiveTool {
  stepIdx: number;
  name: string;
  activity: Activity;
  startedAt: number;
}

export interface AntigravityLiveSession {
  sessionId: string;
  cwd?: string;
  transcriptPath?: string;
  model?: string;
  status: 'working' | 'idle';
  lastSeenAt: number;
  activity?: Activity;
  activeTool?: AntigravityLiveTool;
}

export class AntigravityLive {
  private sessions = new Map<string, AntigravityLiveSession>();
  private seq = 0;
  private readonly now: () => number;
  private readonly onChange?: () => void;

  constructor(opts: { now?: () => number; onChange?: () => void } = {}) {
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
  }

  ingest(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const ev = raw as Record<string, unknown>;
    const sessionId = str(ev.conversationId) || str(ev.session_id) || str(ev.sessionId);
    const event = str(ev.event) || str(ev.hook_event_name);
    if (!sessionId || !event) return false;

    const at = this.now();
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { sessionId, status: 'idle', lastSeenAt: at };
      this.sessions.set(sessionId, s);
    }
    s.lastSeenAt = at;

    const cwd = firstWorkspacePath(ev.workspacePaths) || str(ev.cwd);
    if (cwd) s.cwd = cwd;
    const tp = str(ev.transcriptPath) || str(ev.transcript_path);
    if (tp) s.transcriptPath = tp;
    const model = str(ev.modelName) || str(ev.model);
    if (model) s.model = model;

    switch (event) {
      case 'SessionStart': {
        s.status = 'idle';
        break;
      }
      case 'PreInvocation': {
        s.status = 'working';
        const prompt = str(ev.lastUserInput) || str(ev.prompt);
        if (prompt) {
          const desc = describePrompt(prompt);
          s.activity = { id: `agy:${sessionId}#live:${++this.seq}`, ...desc, at };
        }
        break;
      }
      case 'PreToolUse': {
        s.status = 'working';
        const tc = ev.toolCall && typeof ev.toolCall === 'object' ? (ev.toolCall as Record<string, unknown>) : ev;
        const rawName = str(tc.name) || str(ev.tool_name);
        const rawArgs = tc.args ?? ev.tool_input;
        if (rawName) {
          const { tool } = mapAntigravityTool(rawName, rawArgs);
          const desc = describeAntigravityTool(rawName, rawArgs);
          const act: Activity = { id: `agy:${sessionId}#live:${++this.seq}`, ...desc, tool, at };
          const stepIdx = typeof ev.stepIdx === 'number' ? ev.stepIdx : 0;
          s.activeTool = { stepIdx, name: tool, activity: act, startedAt: at };
          s.activity = act;
        }
        break;
      }
      case 'PostToolUse': {
        s.status = 'working';
        const err = str(ev.error);
        const prevTool = s.activeTool?.name || 'Tool';
        s.activeTool = undefined;
        if (err) {
          const desc = SPECIAL.error(prevTool, err);
          s.activity = { id: `agy:${sessionId}#live:${++this.seq}`, ...desc, tool: prevTool, at };
        }
        break;
      }
      case 'PostInvocation': {
        break;
      }
      case 'Stop': {
        s.activeTool = undefined;
        const fullyIdle = ev.fullyIdle !== false;
        s.status = fullyIdle ? 'idle' : 'working';
        break;
      }
      default:
        return false;
    }

    this.onChange?.();
    return true;
  }

  get(sessionId: string, now = this.now()): AntigravityLiveSession | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    if (now - s.lastSeenAt > HOOK_PRESENCE_MS) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    if (s.activeTool && now - s.activeTool.startedAt > TOOL_LIVE_MS) {
      s.activeTool = undefined;
    }
    return s;
  }

  activeSessions(now = this.now()): AntigravityLiveSession[] {
    const out: AntigravityLiveSession[] = [];
    for (const id of [...this.sessions.keys()]) {
      const s = this.get(id, now);
      if (s) out.push(s);
    }
    return out;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function firstWorkspacePath(v: unknown): string {
  if (!Array.isArray(v)) return '';
  for (const item of v) {
    const s = str(item);
    if (s) return s;
  }
  return '';
}
