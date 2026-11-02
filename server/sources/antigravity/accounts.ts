// Contas do Google Antigravity: cada superfície (~/.gemini/antigravity-cli, ~/.gemini/antigravity, ~/.gemini/antigravity-ide)
// vira um DetectedAccount registrado via AccountsService.setProviderAccounts('antigravity', ...).
//
// Descoberta:
// - HABBLAUD_ANTIGRAVITY=0 desliga;
// - HABBLAUD_ANTIGRAVITY_DIRS=/a,/b substitui tudo;
// - senão, procura em ~/.gemini/antigravity-cli, ~/.gemini/antigravity e ~/.gemini/antigravity-ide.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseAccountOverrides, type DetectedAccount } from '../../accounts/detect';
import { tr } from '../../../shared/i18n';

/** Paleta de violeta/índigo espacial para diferenciar do âmbar do Claude e do verde/ciano do Codex. */
const ANTIGRAVITY_COLORS = ['#a78bfa', '#818cf8', '#c084fc', '#60a5fa'];

const ANTIGRAVITY_MARKERS = ['conversation_summaries.db', 'brain', 'presence', 'annotations', 'conversations', 'history.jsonl'];

export interface DiscoverAntigravityOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function isAntigravityHome(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return ANTIGRAVITY_MARKERS.some((m) => existsSync(join(dir, m)));
}

export function discoverAntigravityDirs(env: NodeJS.ProcessEnv = process.env, home: string = env.HOME || homedir()): string[] {
  const flag = env.HABBLAUD_ANTIGRAVITY?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string, checkMarker: boolean) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const p = resolve(trimmed.startsWith('~/') ? join(home, trimmed.slice(2)) : trimmed);
    if (seen.has(p)) return;
    if (checkMarker ? !isAntigravityHome(p) : !isDir(p)) return;
    seen.add(p);
    out.push(p);
  };

  if (env.HABBLAUD_ANTIGRAVITY_DIRS?.trim()) {
    for (const part of env.HABBLAUD_ANTIGRAVITY_DIRS.split(',')) add(part, false);
    return out;
  }

  const geminiDir = join(home, '.gemini');
  add(join(geminiDir, 'antigravity-cli'), true);
  add(join(geminiDir, 'antigravity'), true);
  add(join(geminiDir, 'antigravity-ide'), true);
  try {
    for (const entry of readdirSync(geminiDir).sort()) {
      if (entry.startsWith('antigravity')) add(join(geminiDir, entry), true);
    }
  } catch {
    // ~/.gemini pode não existir.
  }
  return out;
}

export interface DetectAntigravityOptions {
  env?: NodeJS.ProcessEnv;
  taken?: { shorts?: readonly string[]; colors?: readonly string[] };
}

/** Tenta extrair o e-mail do usuário autenticado no Antigravity através do cli.log ou log/cli-*.log. */
export function detectAntigravityEmail(dir: string): string | undefined {
  const candidates: string[] = [join(dir, 'cli.log')];
  try {
    const logDir = join(dir, 'log');
    if (existsSync(logDir)) {
      const entries = readdirSync(logDir)
        .filter((f) => f.startsWith('cli-') && f.endsWith('.log'))
        .sort()
        .reverse();
      for (const e of entries.slice(0, 3)) candidates.push(join(logDir, e));
    }
  } catch {
    // ignora se log/ não existir
  }

  const EMAIL_RE = /\b(?:email=|authenticated successfully as )([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/;
  const buf = Buffer.alloc(64 * 1024);
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const fd = openSync(file, 'r');
      try {
        const bytes = readSync(fd, buf, 0, buf.length, 0);
        const text = buf.toString('utf8', 0, bytes);
        const match = EMAIL_RE.exec(text);
        if (match) return match[1];
      } finally {
        closeSync(fd);
      }
    } catch {
      // continua para o próximo candidato
    }
  }
  return undefined;
}

export function detectAntigravityAccounts(dirs: readonly string[], opts: DetectAntigravityOptions = {}): DetectedAccount[] {
  const env = opts.env ?? process.env;
  const overrides = parseAccountOverrides(env.HABBLAUD_ACCOUNTS).filter((o) => o.provider === 'antigravity');
  const usedIds = new Set<string>();
  const usedShorts = new Set((opts.taken?.shorts ?? []).map((s) => s.toUpperCase()));
  return dirs.map((dir, i): DetectedAccount => {
    const base = basename(dir);
    const resolvedDir = resolve(dir);
    const ov =
      overrides.find((o) => o.mountDir && resolve(o.mountDir) === resolvedDir) ??
      overrides.find((o) => o.configDir && resolve(o.configDir) === resolvedDir) ??
      overrides.find((o) => o.id === base || o.id === `antigravity:${base}`);

    const id = ov?.id ?? pickId(base, usedIds);
    usedIds.add(id);
    const short = ov?.short ?? pickShort(base, i, usedShorts);
    usedShorts.add(short.toUpperCase());
    const name = ov?.name ?? labelForBase(base);
    const color = ov?.color ?? ANTIGRAVITY_COLORS[i % ANTIGRAVITY_COLORS.length];
    const configDir = ov?.configDir ?? dir;
    const email = ov?.email ?? detectAntigravityEmail(dir);

    const acc: DetectedAccount = {
      id,
      provider: 'antigravity',
      short,
      name,
      color,
      configDir,
    };
    if (email) acc.email = email;
    return acc;
  });
}

function labelForBase(base: string): string {
  if (base === 'antigravity-cli') return 'Antigravity CLI';
  if (base === 'antigravity') return 'Antigravity';
  if (base === 'antigravity-ide') return 'Antigravity IDE';
  const suffix = base.replace(/^antigravity[-_]?/i, '').trim();
  return suffix ? tr('Antigravity ({0})', [suffix]) : 'Antigravity';
}

function pickId(base: string, taken: ReadonlySet<string>): string {
  const first = base.startsWith('antigravity') ? base : `antigravity:${base}`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const cand = `antigravity:${base}#${n}`;
    if (!taken.has(cand)) return cand;
  }
}

function pickShort(base: string, index: number, taken: ReadonlySet<string>): string {
  const candidates: string[] = [];
  if (base === 'antigravity-cli') candidates.push('A', 'AC');
  else if (base === 'antigravity') candidates.push('G', 'AG');
  else if (base === 'antigravity-ide') candidates.push('AI', 'A');
  const suffix = base.replace(/^antigravity[-_]?/i, '');
  if (suffix) candidates.push(`A${suffix[0].toUpperCase()}`);
  candidates.push('A', 'G', `A${index + 1}`);
  for (const c of candidates) {
    if (!taken.has(c.toUpperCase())) return c;
  }
  for (let n = 2; ; n++) {
    const c = `A${n}`;
    if (!taken.has(c.toUpperCase())) return c;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export interface AntigravityBindMount {
  source: string;
  target: string;
}

export interface AntigravityAccountMount {
  account: DetectedAccount;
  hostDir: string;
  mountDir: string;
  binds: AntigravityBindMount[];
}

export const ANTIGRAVITY_CONTAINER_ROOT = '/antigravity';
/** O que o Habblaud lê da pasta (o resto, como conversations/*.pb, nunca é aberto). */
export const ANTIGRAVITY_MOUNTED_ITEMS = ['conversation_summaries.db', 'brain', 'annotations', 'presence', 'history.jsonl'] as const;

/**
 * Monta a pasta da conta INTEIRA (o docker-up sempre monta `read_only`), e não arquivo por arquivo: a base SQLite fica
 * em modo WAL (`-wal`/`-shm` que aparecem e somem), um bind de arquivo que ainda não existe vira diretório no host e um
 * bind de arquivo trocado por rename atômico fica preso ao inode antigo.
 */
export function planAntigravityMounts(
  dirs: readonly string[],
  accounts: readonly DetectedAccount[],
): AntigravityAccountMount[] {
  const out: AntigravityAccountMount[] = [];
  dirs.forEach((hostDir, i) => {
    const account = accounts[i];
    if (!account) return;
    if (!ANTIGRAVITY_MOUNTED_ITEMS.some((sub) => existsSync(join(hostDir, sub)))) return;
    const mountDir = `${ANTIGRAVITY_CONTAINER_ROOT}/${account.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    out.push({ account, hostDir, mountDir, binds: [{ source: hostDir, target: mountDir }] });
  });
  return out;
}
