// Instala, remove ou confere os hooks do Habblaud no Google Antigravity (~/.gemini/config/hooks.json).
// Uso: npm run antigravity:<install|uninstall|status>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { tr } from '../shared/i18n';

export const ROOT = resolve(import.meta.dirname, '..');
export const HOOK_SCRIPT = join(ROOT, 'mod', 'habblaud-antigravity', 'hook.mjs');
const HOOK_MARK = /habblaud-antigravity[\\/]+hook\.mjs/;

export const EVENTS = ['SessionStart', 'PreInvocation', 'PostInvocation', 'PreToolUse', 'PostToolUse', 'Stop'] as const;
export type AntigravityHookEvent = (typeof EVENTS)[number];

export interface InstallSpec {
  nodeBin: string;
  scriptPath: string;
  waitSeconds: number;
}

export function hookCommand(spec: InstallSpec, event: AntigravityHookEvent): string {
  const q = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
  return `${q(spec.nodeBin)} ${q(spec.scriptPath)} ${event}`;
}

export function isHabblaudHook(h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  const cmd = (h as Record<string, unknown>).command;
  return typeof cmd === 'string' && HOOK_MARK.test(cmd);
}

export function mergeHooksJson(raw: Record<string, unknown>, spec: InstallSpec): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  const hooksObj: Record<string, unknown[]> =
    out.hooks && typeof out.hooks === 'object' && !Array.isArray(out.hooks)
      ? { ...(out.hooks as Record<string, unknown[]>) }
      : {};

  for (const ev of EVENTS) {
    const existingGroups = Array.isArray(hooksObj[ev]) ? hooksObj[ev] : [];
    const cleaned = existingGroups
      .map((g) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) return g;
        const group = { ...(g as Record<string, unknown>) };
        if (Array.isArray(group.hooks)) {
          group.hooks = group.hooks.filter((h) => !isHabblaudHook(h));
        }
        return group;
      })
      .filter((g) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) return true;
        const hooks = (g as Record<string, unknown>).hooks;
        return !Array.isArray(hooks) || hooks.length > 0;
      });

    const timeout = ev === 'PreToolUse' ? spec.waitSeconds + 10 : 5;
    const entry: Record<string, unknown> = {
      ...(ev === 'PreToolUse' || ev === 'PostToolUse' ? { matcher: '*' } : {}),
      hooks: [
        {
          type: 'command',
          command: hookCommand(spec, ev),
          timeout,
        },
      ],
    };
    hooksObj[ev] = [...cleaned, entry];
  }

  out.hooks = hooksObj;
  return out;
}

export function removeHooksJson(raw: Record<string, unknown>): { next: Record<string, unknown>; removed: boolean } {
  if (!raw.hooks || typeof raw.hooks !== 'object' || Array.isArray(raw.hooks)) {
    return { next: raw, removed: false };
  }
  let removed = false;
  const hooksObj: Record<string, unknown> = { ...(raw.hooks as Record<string, unknown>) };
  for (const [ev, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) continue;
    const nextGroups = groups
      .map((g) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) return g;
        const group = { ...(g as Record<string, unknown>) };
        if (Array.isArray(group.hooks)) {
          const before = group.hooks.length;
          const filtered = group.hooks.filter((h) => !isHabblaudHook(h));
          group.hooks = filtered;
          if (filtered.length !== before) removed = true;
        }
        return group;
      })
      .filter((g) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) return true;
        const hooks = (g as Record<string, unknown>).hooks;
        return !Array.isArray(hooks) || hooks.length > 0;
      });
    if (nextGroups.length > 0) hooksObj[ev] = nextGroups;
    else delete hooksObj[ev];
  }
  return { next: { ...raw, hooks: hooksObj }, removed };
}

export function checkHooksJson(raw: Record<string, unknown>): { installed: AntigravityHookEvent[]; missing: AntigravityHookEvent[] } {
  const installed: AntigravityHookEvent[] = [];
  const missing: AntigravityHookEvent[] = [];
  const hooksObj = raw.hooks && typeof raw.hooks === 'object' && !Array.isArray(raw.hooks)
    ? (raw.hooks as Record<string, unknown>)
    : {};
  for (const ev of EVENTS) {
    const groups = Array.isArray(hooksObj[ev]) ? hooksObj[ev] : [];
    const has = groups.some((g) => {
      if (!g || typeof g !== 'object') return false;
      const hs = (g as Record<string, unknown>).hooks;
      return Array.isArray(hs) && hs.some((h) => isHabblaudHook(h));
    });
    if (has) installed.push(ev);
    else missing.push(ev);
  }
  return { installed, missing };
}

export function hooksFilePath(home = homedir()): string {
  return join(home, '.gemini', 'config', 'hooks.json');
}

function readJsonOrEmpty(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

export function runCli(argv = process.argv.slice(2), home = homedir()): void {
  const cmd = argv[0] || 'status';
  const file = hooksFilePath(home);
  const spec: InstallSpec = {
    nodeBin: process.execPath,
    scriptPath: HOOK_SCRIPT,
    waitSeconds: 120,
  };

  if (cmd === 'install') {
    const raw = readJsonOrEmpty(file);
    if (existsSync(file)) copyFileSync(file, `${file}.bak`);
    mkdirSync(dirname(file), { recursive: true });
    const merged = mergeHooksJson(raw, spec);
    writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    const cfgDir = join(home, '.habblaud');
    mkdirSync(cfgDir, { recursive: true });
    const cfgFile = join(cfgDir, 'antigravity-hook.json');
    if (!existsSync(cfgFile)) {
      writeFileSync(
        cfgFile,
        `${JSON.stringify({ port: Number(process.env.HABBLAUD_PORT) || 4747, waitSeconds: 120, askPermissions: false }, null, 2)}\n`,
        'utf8',
      );
    }
    console.log(tr('✓ Hooks do Habblaud instalados no Antigravity em {0}', [file]));
    return;
  }

  if (cmd === 'uninstall') {
    if (!existsSync(file)) {
      console.log(tr('Nenhum hooks.json encontrado em {0}', [file]));
      return;
    }
    const raw = readJsonOrEmpty(file);
    const { next, removed } = removeHooksJson(raw);
    if (removed) {
      copyFileSync(file, `${file}.bak`);
      writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      console.log(tr('✓ Hooks do Habblaud removidos de {0}', [file]));
    } else {
      console.log(tr('Nenhum hook do Habblaud estava instalado em {0}', [file]));
    }
    return;
  }

  const raw = readJsonOrEmpty(file);
  const st = checkHooksJson(raw);
  if (st.missing.length === 0) {
    console.log(tr('✓ Antigravity: todos os hooks instalados em {0} ({1})', [file, st.installed.join(', ')]));
  } else {
    console.log(tr('! Antigravity: faltando hooks em {0} ({1}); rode npm run antigravity:install', [file, st.missing.join(', ')]));
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('antigravity-install.ts')) {
  runCli();
}
