// Endpoint HTTP dos hooks do Google Antigravity (mod/habblaud-antigravity/hook.mjs):
//   POST /api/antigravity/events  {conversationId, event, ...} -> 200 {ok: true}
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http/app';
import type { AntigravityLive } from '../sources/antigravity/live';

export interface AntigravityEventDeps {
  live?: AntigravityLive;
  onSession?: (sessionId: string) => void;
}

export async function handleAntigravityEvent(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AntigravityEventDeps,
): Promise<void> {
  const body = await readJson(req);
  if (!deps.live) {
    sendJson(res, 200, { ok: false });
    return;
  }
  const accepted = deps.live.ingest(body);
  if (accepted && body && typeof body === 'object') {
    const ev = body as Record<string, unknown>;
    const sid =
      (typeof ev.conversationId === 'string' && ev.conversationId.trim()) ||
      (typeof ev.session_id === 'string' && ev.session_id.trim()) ||
      '';
    if (sid) deps.onSession?.(sid);
  }
  sendJson(res, 200, { ok: accepted });
}
