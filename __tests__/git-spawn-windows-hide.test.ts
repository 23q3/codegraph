/**
 * Static source guard (all platforms): every `git` child process spawned from
 * `src/` must set `windowsHide: true`.
 *
 * The watcher and indexer run git from the detached MCP daemon, which has no
 * console of its own. On Windows, each git call made without windowsHide gets
 * a brand-new console window that flashes on screen and closes — once per
 * call, every time the daemon re-scans (#485, #928, #1092). The two git calls
 * added for exclude-standard scope parity (#1728) regressed exactly this.
 *
 * windowsHide is Windows-only behavior the POSIX test runs can't observe, so
 * it's asserted at the source level — which also catches any new git call site.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.join(__dirname, '..', 'src');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Text from the bracket at `open` through its balanced partner. */
function balanced(src: string, open: number, pair: '()' | '{}'): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === pair[0]) depth++;
    else if (src[i] === pair[1] && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/**
 * True when the call passes windowsHide: inline in an options literal, or via
 * an options variable (e.g. `gitOpts`) whose object literal sets it.
 */
function setsWindowsHide(src: string, call: string): boolean {
  if (/windowsHide:\s*true/.test(call)) return true;
  const lastArg = /,\s*([A-Za-z_$][\w$]*)\s*,?\s*\)$/.exec(call);
  if (!lastArg) return false;
  const decl = new RegExp(`\\b(?:const|let)\\s+${lastArg[1]}\\b[^=]*=\\s*\\{`).exec(src);
  if (!decl) return false;
  const literal = balanced(src, decl.index + decl[0].length - 1, '{}');
  return /windowsHide:\s*true/.test(literal);
}

describe('git child processes set windowsHide (#1092)', () => {
  it('every git spawn under src/ sets windowsHide: true', () => {
    const gitCall = /\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*'git'/g;
    const offenders: string[] = [];
    let seen = 0;
    for (const file of listSourceFiles(SRC_DIR)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(gitCall)) {
        seen++;
        const call = balanced(src, m.index! + m[0].indexOf('('), '()');
        if (!setsWindowsHide(src, call)) {
          const line = src.slice(0, m.index).split(/\r?\n/).length;
          offenders.push(`${path.relative(SRC_DIR, file)}:${line}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(0); // guard against a false pass if the calls move
    expect(offenders, `git spawned without windowsHide at: ${offenders.join(', ')}`).toEqual([]);
  });
});
