/* tests/helpers/repo.mjs — TEST-ONLY. Never shipped, never referenced by the site.
 *
 * Shared, dependency-free primitives for the test suite: root resolution, memoised
 * file reads, the page list, a small HTML tokenizer, a CSS block parser, and
 * non-throwing git wrappers. Node stdlib only (node:fs, node:path, node:url,
 * node:child_process) — the repo has zero npm dependencies and no build step.
 *
 * THIS FILE IS NOT A TEST FILE, and it is inert only because the directory is
 * `tests/` (plural). Node's default `node --test` glob matches `**\/*.test.mjs`
 * and `**\/test/**` — verified on Node v25.9.0 that `tests/helpers/*.mjs` is NOT
 * picked up. Rename this directory to the singular `test/` and Node will execute
 * every helper here as a test file that asserts nothing and reports green.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the repository root (this file lives at <root>/tests/helpers/). */
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Absolute path for a repo-relative path. */
export function abs(rel) {
  return path.resolve(ROOT, rel);
}

const fileCache = new Map();

/** Memoised utf8 read of a repo-relative file. Throws if it does not exist. */
export function read(rel) {
  if (!fileCache.has(rel)) fileCache.set(rel, readFileSync(abs(rel), "utf8"));
  return fileCache.get(rel);
}

/** True when a repo-relative path exists on disk. */
export function exists(rel) {
  return existsSync(abs(rel));
}

/** Byte size of a repo-relative file, or null when it does not exist. */
export function sizeOf(rel) {
  return exists(rel) ? statSync(abs(rel)).size : null;
}

/**
 * Every top-level HTML page, sorted. ALWAYS derived from the directory listing —
 * never a hardcoded list — so an eighth page is covered the moment it is added.
 */
export function pageFiles() {
  return readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"))
    .sort();
}

/** [{ file, html }] for every page. */
export function pages() {
  return pageFiles().map((file) => ({ file, html: read(file) }));
}

/** Raw HTML of one page, by file name (e.g. "contact.html"). */
export function pageHtml(file) {
  return read(file);
}

/** Memoised parse of vercel.json. */
let vercelCache = null;
export function vercelConfig() {
  if (vercelCache === null) vercelCache = JSON.parse(read("vercel.json"));
  return vercelCache;
}

/** 1-based line number of a character offset. */
export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/* ------------------------------------------------------------------ *
 * cleanUrls path mapping
 * ------------------------------------------------------------------ */

/** The served path for a page file under vercel.json's cleanUrls: index.html -> "/", about.html -> "/about". */
export function pagePath(file) {
  const base = file.replace(/\.html$/, "");
  return base === "index" ? "/" : `/${base}`;
}

/** Strip "?query" and "#fragment" from an href. */
export function stripQuery(href) {
  return href.replace(/[?#].*$/, "");
}

/**
 * Resolve an href to what it addresses.
 *
 * Returns { kind, href, path, file, exists } where kind is one of:
 *   "external" (scheme or protocol-relative), "mailto", "anchor" (starts with #),
 *   "internal" (anything else). For "internal", `file` is the repo-relative path
 *   on disk accounting for vercel.json cleanUrls — "/about" -> "about.html",
 *   "/" -> "index.html", "/assets/css/style.css?v=5" -> "assets/css/style.css" —
 *   or null when nothing on disk can serve it.
 */
export function resolveHref(href, { fromFile = "index.html" } = {}) {
  const raw = String(href);
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
    return {
      kind: /^mailto:/i.test(raw) ? "mailto" : "external",
      href: raw,
      path: null,
      file: null,
      exists: false,
    };
  }
  if (raw.startsWith("#")) {
    return { kind: "anchor", href: raw, path: null, file: null, exists: false };
  }

  const clean = stripQuery(raw);
  let urlPath;
  if (clean.startsWith("/")) {
    urlPath = clean;
  } else {
    const dir = path.posix.dirname("/" + fromFile.replace(/\\/g, "/"));
    urlPath = path.posix.resolve(dir, clean);
  }

  const candidates = [];
  const relative = urlPath.replace(/^\/+/, "");
  if (urlPath === "/" || relative === "") {
    candidates.push("index.html");
  } else if (relative.endsWith("/")) {
    candidates.push(`${relative}index.html`);
  } else {
    candidates.push(relative); // a literal file: assets/css/style.css
    candidates.push(`${relative}.html`); // cleanUrls: /about -> about.html
    candidates.push(`${relative}/index.html`);
  }

  const file = candidates.find((c) => exists(c) && statSync(abs(c)).isFile()) || null;
  return { kind: "internal", href: raw, path: urlPath, file, exists: file !== null };
}

/* ------------------------------------------------------------------ *
 * HTML tokenizer
 * ------------------------------------------------------------------ */

/** Elements that never have a closing tag. */
export const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Elements whose content is raw text and must not be tokenized as markup. */
export const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

const ATTR_RE = /([:@\w.-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function parseAttrs(inner) {
  const attrs = new Map();
  const body = inner.replace(/\/\s*$/, "");
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(body)) !== null) {
    const name = m[1].toLowerCase();
    let value = m[2];
    if (value === undefined) value = "";
    else if (value[0] === '"' || value[0] === "'") value = value.slice(1, -1);
    if (!attrs.has(name)) attrs.set(name, value);
  }
  return attrs;
}

// Index of the '>' that closes a tag starting at `from`, quote-aware so that
// `alt="a > b"` does not end the tag early. Returns html.length when unclosed.
function findTagEnd(html, from) {
  let quote = null;
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return html.length;
}

/**
 * Tokenize HTML into { type: "open" | "close" | "text", name, attrs, index, end, ... }.
 *
 * Comments are stripped entirely; doctypes are skipped; <script>/<style>/<textarea>/<title>
 * are treated as raw text (their contents emit a single text token, so a `<div>` inside a
 * script string never unbalances the stream). The returned array carries a non-enumerable
 * `source` property so sliceElement() can be called with just (tokens, i).
 */
export function tokenize(html) {
  const tokens = [];
  Object.defineProperty(tokens, "source", { value: html, enumerable: false });

  const pushText = (start, end) => {
    if (end > start) {
      tokens.push({ type: "text", name: "#text", text: html.slice(start, end), index: start, end });
    }
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      pushText(i, html.length);
      break;
    }
    pushText(i, lt);

    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const close = findTagEnd(html, lt + 2);
      i = Math.min(close + 1, html.length);
      continue;
    }

    const closing = html[lt + 1] === "/";
    const nameStart = lt + (closing ? 2 : 1);
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]*/.exec(html.slice(nameStart, nameStart + 64));
    if (!nameMatch) {
      pushText(lt, lt + 1); // a stray '<' in text
      i = lt + 1;
      continue;
    }

    const name = nameMatch[0].toLowerCase();
    const inner = html.slice(nameStart + nameMatch[0].length, findTagEnd(html, nameStart + nameMatch[0].length));
    const end = Math.min(findTagEnd(html, nameStart + nameMatch[0].length) + 1, html.length);

    if (closing) {
      tokens.push({ type: "close", name, attrs: new Map(), index: lt, end, selfClosing: false });
      i = end;
      continue;
    }

    const selfClosing = /\/\s*$/.test(inner) || VOID_ELEMENTS.has(name);
    tokens.push({ type: "open", name, attrs: parseAttrs(inner), index: lt, end, selfClosing });

    if (RAW_TEXT_ELEMENTS.has(name) && !selfClosing) {
      const closeRe = new RegExp(`</${name}\\s*>`, "i");
      const rest = html.slice(end);
      const m = closeRe.exec(rest);
      if (m) {
        pushText(end, end + m.index);
        const closeStart = end + m.index;
        const closeEnd = closeStart + m[0].length;
        tokens.push({ type: "close", name, attrs: new Map(), index: closeStart, end: closeEnd, selfClosing: false });
        i = closeEnd;
      } else {
        pushText(end, html.length);
        i = html.length;
      }
      continue;
    }

    i = end;
  }

  return tokens;
}

/** Attribute value, or null when absent. Accepts a token or an attrs Map. */
export function attr(tokenOrAttrs, name) {
  const attrs = tokenOrAttrs instanceof Map ? tokenOrAttrs : tokenOrAttrs.attrs;
  if (!attrs) return null;
  const key = name.toLowerCase();
  return attrs.has(key) ? attrs.get(key) : null;
}

/** The class attribute split on whitespace. Accepts a token or an attrs Map. */
export function classTokens(tokenOrAttrs) {
  const value = attr(tokenOrAttrs, "class");
  if (!value) return [];
  return value.split(/\s+/).filter(Boolean);
}

/**
 * Index of the close token matching the open token at `i`, nesting-safe.
 * Returns -1 for void/self-closing elements and for an unclosed element.
 */
export function matchingClose(tokens, i) {
  const open = tokens[i];
  if (!open || open.type !== "open" || open.selfClosing) return -1;
  let depth = 0;
  for (let j = i + 1; j < tokens.length; j += 1) {
    const t = tokens[j];
    if (t.name !== open.name) continue;
    if (t.type === "open" && !t.selfClosing) depth += 1;
    else if (t.type === "close") {
      if (depth === 0) return j;
      depth -= 1;
    }
  }
  return -1;
}

/** Nesting-safe source substring of the element opening at token `i` (tag included). */
export function sliceElement(tokens, i, html = tokens.source) {
  const open = tokens[i];
  if (!open) return "";
  const close = matchingClose(tokens, i);
  if (close === -1) return html.slice(open.index, open.end);
  return html.slice(open.index, tokens[close].end);
}

/** Every open token matching a predicate: findElements(tokens, t => t.name === "a"). */
export function findElements(tokens, predicate) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === "open" && predicate(t, i)) out.push({ token: t, index: i });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * CSS block parser
 * ------------------------------------------------------------------ */

/**
 * Leaf declaration blocks of a stylesheet, in source order.
 *
 * A char scan tracking comment state, string state and brace depth. Only blocks
 * that contain no nested block are emitted (so `@media { .a {} }` yields `.a`,
 * not the media query), with the enclosing at-rule preludes recorded on `atRules`.
 * Returns [{ selectors, prelude, body, sourceIndex, line, atRules }].
 */
export function cssBlocks(css) {
  const out = [];
  const stack = [];
  let buffer = "";
  let bufferStart = 0;
  let i = 0;

  while (i < css.length) {
    const two = css.slice(i, i + 2);
    if (two === "/*") {
      const close = css.indexOf("*/", i + 2);
      i = close === -1 ? css.length : close + 2;
      continue;
    }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === "\\") j += 2;
        else if (css[j] === ch) break;
        else j += 1;
      }
      buffer += css.slice(i, Math.min(j + 1, css.length));
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      const prelude = buffer.trim();
      stack.push({ prelude, start: bufferStart, bodyStart: i + 1, hasChild: false });
      if (stack.length > 1) stack[stack.length - 2].hasChild = true;
      buffer = "";
      bufferStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      const frame = stack.pop();
      if (frame && !frame.hasChild) {
        out.push({
          prelude: frame.prelude,
          selectors: frame.prelude
            .split(",")
            .map((s) => s.trim().replace(/\s+/g, " "))
            .filter(Boolean),
          body: css.slice(frame.bodyStart, i),
          sourceIndex: frame.start,
          line: lineOf(css, frame.start),
          atRules: stack.filter((f) => f.prelude.startsWith("@")).map((f) => f.prelude),
        });
      }
      buffer = "";
      bufferStart = i + 1;
      i += 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }

  return out;
}

/** Every declaration in a block body as [property, value] pairs, in source order. */
export function declarations(block) {
  const body = typeof block === "string" ? block : block.body;
  const out = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < body.length) {
    if (body.slice(i, i + 2) === "/*") {
      const close = body.indexOf("*/", i + 2);
      i = close === -1 ? body.length : close + 2;
      continue;
    }
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < body.length) {
        if (body[j] === "\\") j += 2;
        else if (body[j] === ch) break;
        else j += 1;
      }
      current += body.slice(i, Math.min(j + 1, body.length));
      i = j + 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      pushDecl(out, current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  pushDecl(out, current);
  return out;
}

function pushDecl(out, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const colon = trimmed.indexOf(":");
  if (colon === -1) return;
  out.push([trimmed.slice(0, colon).trim().toLowerCase(), trimmed.slice(colon + 1).trim()]);
}

/** The LAST value declared for a property in a block (CSS cascade order), or null. */
export function decl(block, prop) {
  const want = prop.toLowerCase();
  let value = null;
  for (const [name, val] of declarations(block)) {
    if (name === want) value = val;
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * git
 * ------------------------------------------------------------------ */

/** Run git in ROOT. Never throws: returns { ok, out, status, err }. */
export function git(args) {
  try {
    const out = execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out, status: 0, err: "" };
  } catch (error) {
    return {
      ok: false,
      out: typeof error.stdout === "string" ? error.stdout : "",
      status: typeof error.status === "number" ? error.status : -1,
      err: typeof error.stderr === "string" ? error.stderr : String(error.message || error),
    };
  }
}

/** True when ROOT is inside a usable git worktree (git installed, history present). */
export function isGitWorktree() {
  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out.trim() !== "true") return false;
  return git(["rev-parse", "HEAD"]).ok;
}

if (import.meta.main) {
  const files = pageFiles();
  const css = read("assets/css/style.css");
  process.stdout.write(
    [
      `ROOT        ${ROOT}`,
      `pages       ${files.length}: ${files.join(", ")}`,
      `tokens      contact.html -> ${tokenize(read("contact.html")).length}`,
      `cssBlocks   style.css -> ${cssBlocks(css).length}`,
      `git         worktree=${isGitWorktree()}`,
      "",
    ].join("\n"),
  );
}
