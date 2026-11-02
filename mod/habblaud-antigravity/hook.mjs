#!/usr/bin/env node
// Hook do Habblaud para o Google Antigravity (~/.gemini/config/hooks.json).
// Eventos suportados: SessionStart, PreInvocation, PostInvocation, PreToolUse, PostToolUse, Stop.
// - Sempre envia o evento ao vivo para POST /api/antigravity/events (para o escritório mostrar o estado e a ferramenta
//   em tempo real).
// - Em PreToolUse de ask_question (ou de comandos quando askPermissions=true em ~/.habblaud/antigravity-hook.json),
//   abre o pedido no escritório em POST /api/permissions e aguarda em GET /api/permissions/:id/wait.
// - Em PreInvocation, PostInvocation e Stop, consulta POST /api/messages/inbox e confirma em POST /api/messages/ack,
//   injetando mensagens enviadas pelo escritório no turno da sessão.
// Falhas de rede nunca travam o Antigravity (saída 0 silenciosa).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_PORT = 4747;
const DEFAULT_WAIT_S = 120;
const EVENT_TIMEOUT_MS = 1_500;
const INBOX_TIMEOUT_MS = 1_500;

function loadConfig() {
  let port = Number(process.env.HABBLAUD_PORT) || DEFAULT_PORT;
  let waitS = DEFAULT_WAIT_S;
  let askPermissions = false;
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.habblaud', 'antigravity-hook.json'), 'utf8'));
    if (!process.env.HABBLAUD_PORT && Number.isInteger(raw?.port) && raw.port >= 1 && raw.port <= 65535) {
      port = raw.port;
    }
    if (Number.isInteger(raw?.waitSeconds) && raw.waitSeconds >= 5 && raw.waitSeconds <= 600) {
      waitS = raw.waitSeconds;
    }
    if (typeof raw?.askPermissions === 'boolean') {
      askPermissions = raw.askPermissions;
    }
  } catch {
    // Sem arquivo de configuração: usa os padrões.
  }
  return { port, waitS, askPermissions };
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

function request(port, method, path, body, timeoutMs) {
  return new Promise((resolve) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        timeout: timeoutMs,
        headers: payload
          ? { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, json: undefined });
    });
    req.on('error', () => resolve({ status: 0, json: undefined }));
    if (payload) req.write(payload);
    req.end();
  });
}

function inferEvent(argEvent, payload) {
  if (argEvent) return argEvent;
  if (typeof payload.event === 'string' && payload.event) return payload.event;
  if (typeof payload.hook_event_name === 'string' && payload.hook_event_name) return payload.hook_event_name;
  if (payload.terminationReason !== undefined || payload.fullyIdle !== undefined) return 'Stop';
  if (payload.toolCall && payload.error !== undefined) return 'PostToolUse';
  if (payload.toolCall) return 'PreToolUse';
  if (payload.lastUserInput !== undefined) return 'PreInvocation';
  return 'SessionStart';
}

function mapQuestionsForOffice(rawQuestions) {
  if (!Array.isArray(rawQuestions)) return [];
  return rawQuestions.map((q) => {
    if (!q || typeof q !== 'object') return q;
    const opts = Array.isArray(q.options)
      ? q.options.map((o) => (typeof o === 'string' ? { label: o } : o))
      : [];
    return {
      question: q.question,
      header: q.header,
      multiSelect: Boolean(q.is_multi_select ?? q.multiSelect),
      options: opts,
    };
  });
}

async function handlePreToolUse(port, waitS, askPermissions, sessionId, cwd, payload) {
  const tc = payload.toolCall && typeof payload.toolCall === 'object' ? payload.toolCall : {};
  const name = typeof tc.name === 'string' ? tc.name : '';
  const args = tc.args && typeof tc.args === 'object' ? tc.args : {};

  const isQuestion = name === 'ask_question';
  const isCommand = name === 'run_command' && askPermissions;
  if (!isQuestion && !isCommand) return;

  const toolName = isQuestion ? 'AskUserQuestion' : 'Bash';
  const toolInput = isQuestion
    ? { questions: mapQuestionsForOffice(args.questions) }
    : { command: args.CommandLine || args.command || '', description: args.toolSummary || '' };

  const created = await request(
    port,
    'POST',
    '/api/permissions',
    {
      session_id: sessionId,
      cwd,
      tool_name: toolName,
      tool_input: toolInput,
    },
    EVENT_TIMEOUT_MS,
  );
  const id = created.json?.id;
  if (created.status !== 201 || typeof id !== 'string') return;

  const waited = await request(
    port,
    'GET',
    `/api/permissions/${encodeURIComponent(id)}/wait?timeout=${waitS * 1000}`,
    undefined,
    (waitS + 5) * 1000,
  );
  const decision = waited.json?.decision;
  if (decision === 'allow') {
    const answers = waited.json?.updatedInput?.answers;
    if (isQuestion && answers && typeof answers === 'object') {
      const formatted = Object.entries(answers)
        .map(([q, a]) => `${q}: ${a}`)
        .join('\n');
      process.stdout.write(
        JSON.stringify({
          decision: 'deny',
          reason: `Respuesta del usuario desde Habblaud:\n${formatted}`,
        }),
      );
      return;
    }
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } else if (decision === 'deny') {
    process.stdout.write(
      JSON.stringify({
        decision: 'deny',
        reason: waited.json?.message || 'Rechazado en Habblaud.',
      }),
    );
  }
}

async function handleMessages(port, sessionId, event) {
  if (event !== 'PreInvocation' && event !== 'PostInvocation' && event !== 'Stop') return;
  const polled = await request(port, 'POST', '/api/mod/inbox', { session: sessionId }, INBOX_TIMEOUT_MS);
  const messages = Array.isArray(polled.json?.messages) ? polled.json.messages : [];
  if (messages.length === 0) return;

  const valid = messages.filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string' && m.text.trim());
  if (valid.length === 0) return;

  await request(
    port,
    'POST',
    '/api/mod/inbox/ack',
    {
      session: sessionId,
      results: valid.map((m) => ({ id: m.id, ok: true })),
    },
    INBOX_TIMEOUT_MS,
  );

  if (event === 'Stop') {
    const combined = valid.map((m) => m.text).join('\n\n');
    process.stdout.write(JSON.stringify({ decision: 'continue', reason: combined }));
  } else {
    process.stdout.write(
      JSON.stringify({
        injectSteps: valid.map((m) => ({ userMessage: m.text })),
      }),
    );
  }
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;

  const { port, waitS, askPermissions } = loadConfig();
  const event = inferEvent(process.argv[2], payload);
  const sessionId =
    (typeof payload.conversationId === 'string' && payload.conversationId.trim()) ||
    (typeof payload.session_id === 'string' && payload.session_id.trim()) ||
    '';
  if (!sessionId) return;

  const cwd =
    Array.isArray(payload.workspacePaths) && typeof payload.workspacePaths[0] === 'string'
      ? payload.workspacePaths[0]
      : typeof payload.cwd === 'string'
        ? payload.cwd
        : '';

  await request(port, 'POST', '/api/antigravity/events', { ...payload, event }, EVENT_TIMEOUT_MS);

  if (event === 'PreToolUse') {
    await handlePreToolUse(port, waitS, askPermissions, sessionId, cwd, payload);
    return;
  }

  await handleMessages(port, sessionId, event);
}

main().catch(() => {
  process.exit(0);
});
