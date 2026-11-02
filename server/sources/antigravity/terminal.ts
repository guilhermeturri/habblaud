// Terminal do Google Antigravity: converte cada linha de brain/<id>/.system_generated/logs/transcript.jsonl em
// TerminalEntry[] (user, thinking, assistant, tool, result), usando as mesmas funções de limpeza e máscara de
// segredos de server/sources/terminal.ts.
import type { TerminalEntry } from '../../../shared/types';
import {
  marked,
  prepare,
  RESULT_MAX,
  RESULT_MAX_LINES,
  TEXT_MAX,
  THINKING_MAX,
  toolView,
  type TerminalParser,
} from '../terminal';
import { extractUserPrompt, mapAntigravityTool } from './transcript';

const SEEN_MAX = 20_000;

class AntigravityTerminalParser implements TerminalParser {
  private out: TerminalEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly pendingToolIds: string[] = [];
  private lastAt?: number;
  private seq = 0;

  push(line: string): TerminalEntry[] {
    this.out = [];
    try {
      this.parseLine(line);
    } catch {
      // Linha inválida nunca interrompe o stream do terminal.
    }
    return this.out;
  }

  private emit(entry: TerminalEntry): void {
    if (this.seen.has(entry.id)) return;
    this.seen.add(entry.id);
    if (this.seen.size > SEEN_MAX) {
      const oldest = this.seen.values().next().value;
      if (oldest) this.seen.delete(oldest);
    }
    this.out.push(entry);
  }

  private parseLine(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length < 2 || trimmed[0] !== '{') return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    const stepIdx = typeof obj.step_index === 'number' ? obj.step_index : ++this.seq;
    const parsedAt = typeof obj.created_at === 'string' ? Date.parse(obj.created_at) : NaN;
    if (!Number.isNaN(parsedAt)) this.lastAt = parsedAt;
    const at = this.lastAt ?? Date.now();

    const type = typeof obj.type === 'string' ? obj.type : '';
    const status = typeof obj.status === 'string' ? obj.status : '';
    const content = typeof obj.content === 'string' ? obj.content : '';

    if (type === 'USER_INPUT') {
      const prompt = extractUserPrompt(content);
      const text = marked(prepare(prompt, TEXT_MAX));
      if (!text) return;
      this.pendingToolIds.length = 0;
      this.emit({
        kind: 'user',
        id: `step-${stepIdx}:user`,
        at,
        text,
      });
      return;
    }

    if (type === 'PLANNER_RESPONSE') {
      const thinkingRaw = typeof obj.thinking === 'string' ? obj.thinking.trim() : '';
      if (thinkingRaw) {
        const text = marked(prepare(thinkingRaw, THINKING_MAX, Infinity, false));
        if (text) {
          this.emit({
            kind: 'thinking',
            id: `step-${stepIdx}:think`,
            at,
            text,
          });
        }
      }

      if (content.trim()) {
        const text = marked(prepare(content.trim(), TEXT_MAX, Infinity, false));
        if (text) {
          this.emit({
            kind: 'assistant',
            id: `step-${stepIdx}:assistant`,
            at,
            text,
          });
        }
      }

      const toolCalls = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
      toolCalls.forEach((tc, idx) => {
        if (!tc || typeof tc !== 'object') return;
        const call = tc as Record<string, unknown>;
        const rawName = typeof call.name === 'string' ? call.name : '';
        if (!rawName) return;
        const { tool, input } = mapAntigravityTool(rawName, call.args);
        const view = toolView(tool, input);
        const toolUseId = `step-${stepIdx}:tool-${idx}`;
        this.pendingToolIds.push(toolUseId);
        this.emit({
          kind: 'tool',
          id: toolUseId,
          at,
          tool,
          title: view.title,
          ...(view.input ? { input: view.input } : {}),
          ...(view.inputKind ? { inputKind: view.inputKind } : {}),
        });
      });
      return;
    }

    if (type === 'GENERIC') {
      const toolUseId = this.pendingToolIds.shift() ?? `step-${stepIdx}:tool-0`;
      const prep = prepare(content, RESULT_MAX, RESULT_MAX_LINES, false);
      this.emit({
        kind: 'result',
        id: `step-${stepIdx}:result`,
        at,
        toolUseId,
        text: prep.text,
        ...(status === 'ERROR' ? { error: true } : {}),
        ...(prep.truncated ? { truncated: true } : {}),
      });
    }
  }
}

export function createAntigravityTerminalParser(): TerminalParser {
  return new AntigravityTerminalParser();
}
