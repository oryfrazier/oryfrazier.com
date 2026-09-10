/* tests/repo-constraints.test.mjs — invariants about the REPOSITORY, not about
 * any single file it contains.
 *
 * Three things live here that have no natural home in a per-file test:
 *
 *   1. The zero-dependency, no-build-step rule. It is the constraint the whole
 *      architecture is organised around and it is currently enforced by nothing
 *      but absence: there is no package.json in the tree, and the rule is
 *      written down only in the README. The first `npm i` breaks it silently.
 *
 *   2. The CURRENCY of the ?v=N cache-bust token. pages.test.mjs proves the
 *      seven pages agree on a value; it cannot tell you they agree on a STALE
 *      one. See the long comment above that test before deleting it.
 *
 *   3. Page counts written into prose in README.md / TODO.md.
 *
 * Node stdlib only. No network. Every git-dependent assertion degrades to a
 * skip with a message when git, a worktree, or history is unavailable.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ROOT, abs, exists, git, isGitWorktree, lineOf, pageFiles, pages, read } from "./helpers/repo.mjs";

/* ------------------------------------------------------------------ *
 * shared: a directory walk that never descends into .git or node_modules
 * ------------------------------------------------------------------ */

const NEVER_DESCEND = new Set([".git", "node_modules", ".vercel"]);

/** Walk ROOT, returning { files, nodeModules } as repo-relative POSIX paths. */
function walkRepo() {
  const files = [];
  const nodeModules = [];

  const visit = (relDir) => {
    let entries;
    try {
      entries = readdirSync(abs(relDir || "."), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") nodeModules.push(rel);
        if (NEVER_DESCEND.has(entry.name)) continue;
        visit(rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };

  visit("");
  return { files, nodeModules };
}

/* ------------------------------------------------------------------ *
 * 1. zero dependencies, no build step
 * ------------------------------------------------------------------ */

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
]);

const DEPENDENCY_KEYS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

const SOURCE_EXT = new Set([".mjs", ".js", ".cjs", ".ts"]);

/**
 * Blank out // and comments so that prose describing an import (this file has
 * plenty) is not mistaken for one. Quote-aware, so a `//` inside "https://…"
 * survives. String and template contents are left intact — they have to be, the
 * specifiers themselves are string literals.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") j += 2;
        else if (source[j] === ch) break;
        else j += 1;
      }
      out += source.slice(i, Math.min(j + 1, source.length));
      i = j + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? source.length : close + 2;
      // Keep newlines so line numbers and the ^-anchored patterns still line up.
      out += source.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? source.length : nl;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Static-ish import specifiers in a JS source file.
 *
 * Four shapes handled: from-clauses on import and export declarations (the
 * `[^;]*?` keeps a multi-line brace list in scope while refusing to run past a
 * statement end), the bare side-effect import, the dynamic call form, and the
 * CommonJS call form.
 */
function importSpecifiers(rawSource) {
  const source = stripComments(rawSource);
  const found = new Set();
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) found.add(m[1]);
  }
  return [...found];
}

test("the zero-dependency, no-build-step constraint is enforced by something other than absence", () => {
  const { files, nodeModules } = walkRepo();

  assert.deepEqual(
    nodeModules,
    [],
    `node_modules exists in the repo (${nodeModules.join(", ")}). The site ships with zero npm ` +
      "dependencies and no build step; nothing here may require an install to run.",
  );

  const locks = files.filter((f) => LOCKFILES.has(path.posix.basename(f)));
  assert.deepEqual(
    locks,
    [],
    `Lockfile(s) present: ${locks.join(", ")}. A lockfile means a package manager owns this tree; ` +
      "the site has zero npm dependencies.",
  );

  // A bare package.json is allowed (someone may one day want `"type": "module"`),
  // but it must not declare a single dependency of any kind.
  const manifests = files.filter((f) => path.posix.basename(f) === "package.json");
  const offenders = [];
  for (const rel of manifests) {
    let pkg;
    try {
      pkg = JSON.parse(read(rel));
    } catch (error) {
      offenders.push(`${rel}: not valid JSON (${error.message})`);
      continue;
    }
    for (const key of DEPENDENCY_KEYS) {
      const value = pkg[key];
      if (value && typeof value === "object" && Object.keys(value).length > 0) {
        offenders.push(`${rel}: ${key} = ${Object.keys(value).join(", ")}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `package.json declares npm dependencies:\n  ${offenders.join("\n  ")}\n` +
      "ZERO npm dependencies is the repo's hardest constraint — Vercel builds nothing and the " +
      "serverless function runs on the platform's bare Node.",
  );

  // Everything api/ and tests/ import must resolve without an install.
  const sources = files.filter(
    (f) => (f.startsWith("api/") || f.startsWith("tests/")) && SOURCE_EXT.has(path.posix.extname(f)),
  );
  assert.ok(sources.length > 0, "found no source files under api/ or tests/ — the walk is broken");

  const badImports = [];
  for (const rel of sources) {
    for (const spec of importSpecifiers(read(rel))) {
      const ok = spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../");
      if (!ok) badImports.push(`${rel} -> ${JSON.stringify(spec)}`);
    }
  }
  assert.deepEqual(
    badImports,
    [],
    `Bare import specifier(s) — these need an npm install to resolve:\n  ${badImports.join("\n  ")}\n` +
      "Use node:-prefixed builtins or relative paths only.",
  );
});

/* ------------------------------------------------------------------ *
 * 2. the cache-bust token is current, not merely consistent
 * ------------------------------------------------------------------ */

/**
 * READ THIS BEFORE DELETING THE TEST BELOW.
 *
 * pages.test.mjs asserts the seven pages agree on one ?v=N. That is drift, and
 * drift is the easy half. The half that actually shipped a bug is staleness:
 * edit assets/css/style.css, forget the manual `sed`, and all seven pages still
 * say ?v=5, the drift test is green, and every returning visitor is served
 * yesterday's CSS from a year-long immutable cache.
 *
 * This test closes that by asking git — which is already recording the facts —
 * two questions:
 *
 *   committed:     did the last commit that touched style.css also (or precede
 *                  a commit that) introduced the current token?
 *   working tree:  if style.css is dirty right now, is a ?v= line dirty too?
 *
 * It deliberately is NOT a checked-in sha256 manifest: no generated file, no
 * second manual step to forget.
 *
 * ACCEPTED COST, stated plainly: this goes red the moment you edit style.css
 * and stays red until you bump the token. That is the intended behaviour — a
 * five-second reminder with the exact sed command printed — not a false alarm.
 * If it is irritating you mid-session, bump the token; that is the work it is
 * asking for. CI needs actions/checkout with fetch-depth: 0 so `git log -S` can
 * see history.
 */

/* Derived from disk, never listed by hand: a third stylesheet or script added
   later is covered the moment it lands, and a hand-written list is exactly the
   kind of thing that goes stale while reading as if it still means something. */
const BUSTED_ASSETS = ["assets/css", "assets/js"]
  .filter((dir) => exists(dir))
  .flatMap((dir) =>
    readdirSync(abs(dir))
      .filter((name) => /\.(?:css|js)$/.test(name))
      .map((name) => ({ file: `${dir}/${name}`, ref: name })),
  );

/** The set of ?v= values used for one asset across every page. */
function tokensFor(ref) {
  const re = new RegExp(`${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=(\\d+)`, "g");
  const values = new Set();
  for (const { html } of pages()) {
    for (const m of html.matchAll(re)) values.add(m[1]);
  }
  return values;
}

test("the cache-bust token is CURRENT, not merely consistent", (t) => {
  if (!isGitWorktree()) {
    t.skip("not a git worktree (or git unavailable) — cannot ask history when the token last moved");
    return;
  }
  if (git(["rev-parse", "--is-shallow-repository"]).out.trim() === "true") {
    t.skip("shallow clone — `git log -S` cannot see when the token was introduced (needs fetch-depth: 0)");
    return;
  }

  const failures = [];
  let checked = 0;

  for (const { file, ref } of BUSTED_ASSETS) {
    if (!exists(file)) continue;

    const tokens = tokensFor(ref);
    if (tokens.size !== 1) {
      // Drift, or the asset is not cache-busted at all. Either way it is
      // pages.test.mjs's finding, not this test's.
      continue;
    }
    const token = [...tokens][0];
    const next = String(Number(token) + 1);
    const remedy = `sed -i '' 's/?v=${token}/?v=${next}/g' *.html`;

    // --- committed half -------------------------------------------------
    const assetCommit = git(["log", "-1", "--format=%ct", "--", file]).out.trim();
    const tokenCommit = git(["log", "-1", "--format=%ct", "-S", `${ref}?v=${token}`, "--", "*.html"]).out.trim();

    if (assetCommit && tokenCommit) {
      checked += 1;
      if (Number(assetCommit) > Number(tokenCommit)) {
        const assetSubject = git(["log", "-1", "--format=%h %s", "--", file]).out.trim();
        const tokenSubject = git([
          "log", "-1", "--format=%h %s", "-S", `${ref}?v=${token}`, "--", "*.html",
        ]).out.trim();
        failures.push(
          `${file} was last changed AFTER ?v=${token} was introduced.\n` +
            `      asset last touched: ${assetSubject}\n` +
            `      ?v=${token} introduced: ${tokenSubject}\n` +
            `      Visitors are cached on the old ${ref}. Fix: ${remedy}`,
        );
      }
    }

    // --- working-tree half ----------------------------------------------
    const clean = git(["diff", "--quiet", "HEAD", "--", file]);
    const dirty = !clean.ok && clean.status === 1;
    if (dirty) {
      checked += 1;
      const htmlDiff = git(["diff", "HEAD", "--", "*.html"]).out;
      const bumped = new RegExp(`^[+-].*${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=`, "m").test(htmlDiff);
      if (!bumped) {
        failures.push(
          `${file} is modified in the working tree but no page's ?v= token has moved ` +
            `(still ?v=${token} everywhere).\n` +
            `      Commit this and returning visitors keep the cached ${ref} for a year. Fix: ${remedy}`,
        );
      }
    }
  }

  if (checked === 0) {
    t.skip("git history did not answer for either busted asset (empty `git log` output) — nothing to assert");
    return;
  }

  assert.deepEqual(failures, [], `Cache-bust token is stale:\n  - ${failures.join("\n  - ")}\n`);
});

/* ------------------------------------------------------------------ *
 * 3. page counts written into prose
 * ------------------------------------------------------------------ */

const WORD_NUMBERS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
]);

const COUNT_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+pages\b/gi;

const DOCS = ["README.md", "TODO.md"];

/**
 * The point of this test is not tidiness. README.md documents the manual
 * cache-bust as `sed … *.html`, a procedure whose whole safety rests on the
 * maintainer's idea of "all pages" being accurate. A stale count is direct
 * evidence that it isn't.
 *
 * "N pages" in prose does NOT have one denominator, and asserting a single one
 * is how this test produces wrong fixes. Two counts are both legitimate:
 *
 *   - every root .html file (currently 7). The right denominator for anything
 *     about the FILES: "the header is duplicated across seven pages", and for
 *     the `sed … *.html` cache-bust itself.
 *   - the indexable content pages, i.e. minus the `noindex` utility pages
 *     404.html and thanks.html (currently 5). The right denominator for
 *     anything about the SITE as visitors and crawlers see it: "confirm all N
 *     pages show as indexed", "N pages plus 404 and thanks".
 *
 * Demanding the file count everywhere would push "…three pages plus 404 and
 * thanks" to "seven pages plus 404 and thanks" — nine, off a tree of seven.
 * So accept either, and only flag a number that is neither: that is the case
 * where the sentence is provably stale under any reading.
 *
 * Better than pinning any number is to DELETE the numeral. A count that has to
 * be maintained in prose is a count that will go stale again.
 */
function indexablePageFiles() {
  return pages()
    .filter(({ html }) => !/<meta[^>]+name=["']?robots["']?[^>]*noindex/i.test(html))
    .map(({ file }) => file);
}

test("prose page counts in README.md and TODO.md match a real page count", () => {
  const all = pageFiles();
  const indexable = indexablePageFiles();
  assert.ok(all.length > 0, "no root *.html pages found — the page list helper is broken");
  assert.ok(indexable.length > 0, "every page parsed as noindex — the robots-meta probe is broken");

  const accepted = new Set([all.length, indexable.length]);
  const legend =
    `${all.length} root .html files (${all.join(", ")}); ` +
    `${indexable.length} indexable (${indexable.join(", ")})`;

  const offenders = [];
  for (const doc of DOCS) {
    if (!exists(doc)) continue;
    const text = read(doc);
    for (const m of text.matchAll(COUNT_RE)) {
      const raw = m[1].toLowerCase();
      const value = WORD_NUMBERS.has(raw) ? WORD_NUMBERS.get(raw) : Number(raw);
      if (!Number.isFinite(value) || accepted.has(value)) continue;
      const line = lineOf(text, m.index);
      offenders.push(`${doc}:${line} says "${m[0]}", which is neither count — ${legend}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Stale page count in the docs:\n  - ${offenders.join("\n  - ")}\n  ` +
      "Use the file count for statements about the files, the indexable count for " +
      "statements about the live site — or, better, drop the numeral so it cannot go stale.\n",
  );
});
