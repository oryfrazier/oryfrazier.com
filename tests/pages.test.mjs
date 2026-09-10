/* tests/pages.test.mjs — the seven hand-duplicated HTML files as documents.
 *
 * Structural well-formedness, cache-bust token drift, asset resolution, nav/footer
 * duplication, and accessibility. Every assertion runs over the shared tokenizer in
 * tests/helpers/repo.mjs rather than ad-hoc regexes, so comments, inline <script>
 * strings and wrapping <label>s do not produce false results.
 *
 * The page list always comes from readdirSync — an eighth page is covered the moment
 * it is added. Serving and crawling concerns (vercel.json, sitemap, robots, canonical)
 * live in tests/deploy-config.test.mjs.
 *
 * Offline: reads files only. No network, no npm, no build step.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  VOID_ELEMENTS,
  attr,
  classTokens,
  exists,
  findElements,
  lineOf,
  pageFiles,
  pageHtml,
  pagePath,
  read,
  resolveHref,
  sliceElement,
  stripQuery,
  tokenize,
  vercelConfig,
} from "./helpers/repo.mjs";

const PAGES = pageFiles();

/* Paths the PLATFORM serves, which therefore have no file in this repo: Vercel's
   own analytics script under /_vercel/, and anything vercel.json rewrites onto a
   serverless function. A disk walk cannot see either, so both are exempted from
   the two resolution tests below.
   
   An exemption is a hole, so each one is pinned somewhere else rather than
   trusted: tests/deploy-config.test.mjs asserts the analytics snippet byte-exact
   on every page, and that every /go/<slug> link names a slug api/go.mjs actually
   defines. Without those two, a typo in either path would ship green. */
const PLATFORM_PREFIXES = [/^\/_vercel\//];

/** vercel.json rewrite sources as anchored regexes: "/go/:slug" -> ^/go/[^/]+$ */
const REWRITE_SOURCES = (() => {
  const config = vercelConfig();
  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];
  return rewrites.map((rule) => {
    const pattern = String(rule.source)
      .split(/(:[A-Za-z0-9_]+\*?)/)
      .map((part) =>
        /^:[A-Za-z0-9_]+\*?$/.test(part)
          ? part.endsWith("*")
            ? ".*"
            : "[^/]+"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    return new RegExp(`^${pattern}$`);
  });
})();

/** True for a root-relative path served by the platform rather than from disk. */
function isPlatformPath(urlPath) {
  return (
    PLATFORM_PREFIXES.some((re) => re.test(urlPath)) ||
    REWRITE_SOURCES.some((re) => re.test(urlPath))
  );
}

const tokenCache = new Map();
/** Memoised token stream for a page file. */
function tokensOf(file) {
  if (!tokenCache.has(file)) tokenCache.set(file, tokenize(read(file)));
  return tokenCache.get(file);
}

/** "about.html:37" for a character offset, for readable failure messages. */
function at(file, index) {
  return `${file}:${lineOf(read(file), index)}`;
}

/** Open tokens of a given tag name on a page. */
function elements(file, name) {
  return findElements(tokensOf(file), (t) => t.name === name);
}

/** Every open token bearing `attrName`, as { file, token, index, value }. */
function attrRefs(attrName) {
  const out = [];
  for (const file of PAGES) {
    for (const { token, index } of findElements(tokensOf(file), (t) => attr(t, attrName) !== null)) {
      out.push({ file, token, index, value: attr(token, attrName) });
    }
  }
  return out;
}

/** Candidate URLs in a srcset, with the width/density descriptor dropped. */
function srcsetCandidates(value) {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/* Guard against the whole suite silently testing nothing if pageFiles() ever
   returns [] (a moved root, a broken ROOT resolution). */
test("the page list is non-empty and comes from disk", () => {
  assert.ok(PAGES.length >= 5, `expected the site's HTML pages, got ${JSON.stringify(PAGES)}`);
  assert.ok(PAGES.includes("index.html"), `no index.html in ${JSON.stringify(PAGES)}`);
});

test("every page's tags balance, with no unclosed or stray-closed element", () => {
  for (const file of PAGES) {
    const html = read(file);
    const stack = [];
    let problem = null;

    for (const t of tokensOf(file)) {
      if (t.type === "open") {
        if (!t.selfClosing) stack.push(t);
        continue;
      }
      if (t.type !== "close") continue;
      // A stray </br> / </img> is harmless and browsers drop it; the tokenizer
      // never pushed the matching open, so skip rather than report a phantom.
      if (VOID_ELEMENTS.has(t.name)) continue;

      const top = stack[stack.length - 1];
      if (!top) {
        problem = `${at(file, t.index)}: stray </${t.name}> — nothing is open here`;
        break;
      }
      if (top.name !== t.name) {
        problem =
          `${at(file, t.index)}: </${t.name}> closes <${top.name}> ` +
          `opened at ${at(file, top.index)}`;
        break;
      }
      stack.pop();
    }

    if (!problem && stack.length > 0) {
      const unclosed = stack.map((t) => `<${t.name}> at ${at(file, t.index)}`).join(", ");
      problem = `${file}: ${stack.length} element(s) never closed: ${unclosed}`;
    }

    assert.equal(problem, null, String(problem));
  }
});

test("one cache-bust version across every page, and no css/js reference lacks one", () => {
  const VERSIONED = /^\/assets\/(?:css|js)\//;
  const tokenMap = new Map(); // "file:line ref" -> "5"
  const missing = [];
  let refCount = 0;

  for (const file of PAGES) {
    let styleLinks = 0;

    for (const { token, index } of findElements(tokensOf(file), () => true)) {
      for (const attrName of ["href", "src"]) {
        const value = attr(token, attrName);
        if (value === null || !VERSIONED.test(value)) continue;
        refCount += 1;

        if (stripQuery(value).endsWith("/assets/css/style.css")) styleLinks += 1;

        const m = /\?v=(\d+)$/.exec(value);
        if (m === null) missing.push(`${at(file, index)}: ${value} has no ?v= cache-bust token`);
        else tokenMap.set(`${at(file, index)} ${value}`, m[1]);
      }
    }

    assert.equal(
      styleLinks,
      1,
      `${file} references /assets/css/style.css ${styleLinks} time(s), expected exactly 1`,
    );
  }

  assert.deepEqual(missing, [], missing.join("\n"));
  assert.ok(refCount >= PAGES.length, `only ${refCount} css/js references found across ${PAGES.length} pages`);

  const distinct = new Set(tokenMap.values());
  const detail = [...tokenMap].map(([where, v]) => `  v=${v}  ${where}`).join("\n");
  assert.equal(
    distinct.size,
    1,
    `cache-bust tokens have drifted — ${distinct.size} distinct values ${JSON.stringify([...distinct])}:\n${detail}`,
  );
});

test("every referenced asset exists on disk", () => {
  const broken = [];

  const check = (file, index, ref, what) => {
    const clean = stripQuery(ref);
    if (clean === "" || clean.startsWith("#")) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("//")) return; // external
    if (isPlatformPath(clean)) return; // served by Vercel, not from this repo
    const rel = clean.replace(/^\/+/, "");
    if (!exists(rel)) broken.push(`${at(file, index)}: ${what} ${ref} -> ${rel} does not exist`);
  };

  for (const file of PAGES) {
    for (const { token, index } of findElements(tokensOf(file), () => true)) {
      const src = attr(token, "src");
      if (src !== null) check(file, index, src, `<${token.name} src>`);

      const srcset = attr(token, "srcset");
      if (srcset !== null) {
        for (const candidate of srcsetCandidates(srcset)) {
          check(file, index, candidate, `<${token.name} srcset>`);
        }
      }

      if (token.name === "link") {
        const href = attr(token, "href");
        if (href !== null) check(file, index, href, "<link href>");
      }
    }
  }

  // url("…") inside style.css, resolved relative to assets/css/.
  const css = read("assets/css/style.css");
  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/g;
  let m;
  let cssUrls = 0;
  while ((m = urlRe.exec(css)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    const clean = stripQuery(raw);
    if (clean === "" || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(clean)) continue;
    cssUrls += 1;
    const resolved = clean.startsWith("/")
      ? clean.replace(/^\/+/, "")
      : new URL(clean, `file:///assets/css/`).pathname.replace(/^\/+/, "");
    if (!exists(resolved)) {
      broken.push(
        `assets/css/style.css:${lineOf(css, m.index)}: url(${raw}) -> ${resolved} does not exist`,
      );
    }
  }

  assert.ok(cssUrls >= 2, `expected the two @font-face url()s in style.css, found ${cssUrls}`);
  assert.deepEqual(broken, [], `broken asset references:\n${broken.join("\n")}`);
});

test("internal links resolve under cleanUrls and end in no .html", () => {
  const unresolved = [];
  const dotHtml = [];
  let checked = 0;

  for (const file of PAGES) {
    for (const { token, index } of findElements(tokensOf(file), () => true)) {
      for (const attrName of ["href", "src", "action"]) {
        const raw = attr(token, attrName);
        if (raw === null || raw === "") continue;
        if (!raw.startsWith("/") || raw.startsWith("//")) continue; // only root-relative
        checked += 1;

        if (/\.html($|[?#])/.test(raw)) {
          dotHtml.push(`${at(file, index)}: ${attrName}="${raw}" — cleanUrls serves this at a 308 hop`);
        }

        const clean = stripQuery(raw);
        if (isPlatformPath(clean)) continue; // /_vercel/… or a vercel.json rewrite

        if (clean.startsWith("/api/")) {
          // Serverless functions are files under api/ with a runtime extension.
          const base = clean.slice("/api/".length);
          const ok = [".mjs", ".js", ".ts", ""].some((ext) => exists(`api/${base}${ext}`));
          if (!ok) unresolved.push(`${at(file, index)}: ${attrName}="${raw}" — no api/${base}.* on disk`);
          continue;
        }

        const resolved = resolveHref(raw, { fromFile: file });
        if (!resolved.exists) {
          unresolved.push(`${at(file, index)}: ${attrName}="${raw}" resolves to nothing on disk`);
        }
      }
    }
  }

  assert.ok(checked > PAGES.length, `only ${checked} root-relative references found — the walk is not seeing the nav`);
  assert.deepEqual(unresolved, [], `dead internal references:\n${unresolved.join("\n")}`);
  assert.deepEqual(dotHtml, [], `internal links must use clean URLs:\n${dotHtml.join("\n")}`);
});

/** The sequence of <a href> values inside the first element matching `pick`. */
function anchorHrefs(file, pick) {
  const tokens = tokensOf(file);
  const found = findElements(tokens, pick);
  if (found.length === 0) return null;
  const inner = sliceElement(tokens, found[0].index);
  return findElements(tokenize(inner), (t) => t.name === "a").map(({ token }) => attr(token, "href"));
}

test("the nav and footer are identical across all pages, and aria-current marks exactly the right page", () => {
  const navHrefs = new Map();
  const footerHrefs = new Map();

  for (const file of PAGES) {
    const nav = anchorHrefs(file, (t) => t.name === "nav");
    assert.notEqual(nav, null, `${file} has no <nav>`);
    assert.ok(nav.length > 0, `${file}'s <nav> contains no links`);
    navHrefs.set(file, nav);

    const footer = anchorHrefs(file, (t) => classTokens(t).includes("site-footer"));
    assert.notEqual(footer, null, `${file} has no .site-footer`);
    assert.ok(footer.length > 0, `${file}'s .site-footer contains no links`);
    footerHrefs.set(file, footer);
  }

  // Compare the href SEQUENCE, not raw text: raw-text comparison is defeated by
  // the aria-current attribute the current page's own link carries.
  const [first, ...rest] = PAGES;
  for (const file of rest) {
    assert.deepEqual(
      navHrefs.get(file),
      navHrefs.get(first),
      `nav links drifted: ${file} has ${JSON.stringify(navHrefs.get(file))}, ` +
        `${first} has ${JSON.stringify(navHrefs.get(first))}`,
    );
    assert.deepEqual(
      footerHrefs.get(file),
      footerHrefs.get(first),
      `footer links drifted: ${file} has ${JSON.stringify(footerHrefs.get(file))}, ` +
        `${first} has ${JSON.stringify(footerHrefs.get(first))}`,
    );
  }

  // aria-current="page" belongs on the nav link pointing at this very page, and
  // nowhere else — including pages the nav does not link to (index, thanks, 404).
  for (const file of PAGES) {
    const tokens = tokensOf(file);
    const marked = findElements(tokens, (t) => attr(t, "aria-current") !== null).map(({ token, index }) => ({
      name: token.name,
      href: attr(token, "href"),
      value: attr(token, "aria-current"),
      where: at(file, index),
    }));

    const self = pagePath(file);
    const expected = navHrefs.get(file).includes(self) ? 1 : 0;

    assert.equal(
      marked.length,
      expected,
      `${file} (served at ${self}) carries ${marked.length} aria-current attribute(s), expected ${expected}: ` +
        JSON.stringify(marked),
    );
    if (expected === 1) {
      assert.equal(marked[0].value, "page", `${file}: aria-current should be "page", got "${marked[0].value}"`);
      assert.equal(
        marked[0].href,
        self,
        `${file}: aria-current sits on the link to ${marked[0].href}, but this page is served at ${self}`,
      );
    }
  }
});

test("the skip link's target exists, is the <main>, and is focusable", () => {
  for (const file of PAGES) {
    const tokens = tokensOf(file);
    const links = findElements(tokens, (t) => t.name === "a" && classTokens(t).includes("skip-link"));
    assert.equal(links.length, 1, `${file} has ${links.length} .skip-link anchors, expected exactly 1`);

    const href = attr(links[0].token, "href");
    assert.match(href ?? "", /^#\S+$/, `${file}: skip link href must be a fragment, got ${JSON.stringify(href)}`);

    const id = href.slice(1);
    const targets = findElements(tokens, (t) => attr(t, "id") === id);
    assert.equal(targets.length, 1, `${file}: skip link points at #${id}, found ${targets.length} elements with that id`);

    const target = targets[0].token;
    assert.equal(target.name, "main", `${file}: skip link target #${id} is <${target.name}>, expected <main>`);

    // Safari and older WebKit/Firefox will not move focus to a fragment target that
    // is not natively focusable — they scroll and leave focus in the header, so the
    // next Tab lands back on the nav. tabindex="-1" is what makes the link work.
    assert.equal(
      attr(target, "tabindex"),
      "-1",
      `${file}: <main id="${id}"> needs tabindex="-1" or the skip link scrolls without moving focus`,
    );
  }
});

test("document structure: one h1, no heading-level skips, one main, one labelled nav, html lang", () => {
  for (const file of PAGES) {
    const tokens = tokensOf(file);

    const html = findElements(tokens, (t) => t.name === "html");
    assert.equal(html.length, 1, `${file} has ${html.length} <html> elements`);
    const lang = attr(html[0].token, "lang");
    assert.ok(lang && lang.trim() !== "", `${file}: <html> needs a non-empty lang attribute, got ${JSON.stringify(lang)}`);

    const mains = elements(file, "main");
    assert.equal(mains.length, 1, `${file} has ${mains.length} <main> landmarks, expected exactly 1`);

    const navs = elements(file, "nav");
    assert.equal(navs.length, 1, `${file} has ${navs.length} <nav> landmarks, expected exactly 1`);
    const label = attr(navs[0].token, "aria-label") ?? attr(navs[0].token, "aria-labelledby");
    assert.ok(
      label && label.trim() !== "",
      `${file}: <nav> needs aria-label or aria-labelledby so it is distinguishable in a landmark list`,
    );

    const headings = findElements(tokens, (t) => /^h[1-6]$/.test(t.name)).map(({ token, index }) => ({
      level: Number(token.name[1]),
      where: at(file, index),
    }));

    const h1s = headings.filter((h) => h.level === 1);
    assert.equal(h1s.length, 1, `${file} has ${h1s.length} <h1> elements, expected exactly 1: ${JSON.stringify(h1s)}`);

    for (let i = 1; i < headings.length; i += 1) {
      const prev = headings[i - 1];
      const cur = headings[i];
      assert.ok(
        cur.level <= prev.level + 1,
        `${file}: heading level jumps h${prev.level} (${prev.where}) -> h${cur.level} (${cur.where})`,
      );
    }
  }
});

test("every form control has a label, and ids are unique per page", () => {
  // <input> types that are not user-entered data and carry their own accessible
  // name from `value`/content rather than a <label>.
  const UNLABELLED_INPUT_TYPES = new Set(["hidden", "submit", "reset", "button", "image"]);

  for (const file of PAGES) {
    const tokens = tokensOf(file);

    const ids = new Map();
    const duplicates = [];
    for (const { token, index } of findElements(tokens, (t) => attr(t, "id") !== null)) {
      const id = attr(token, "id");
      if (id === "") continue;
      if (ids.has(id)) duplicates.push(`${file}: id="${id}" at ${at(file, index)} and ${ids.get(id)}`);
      else ids.set(id, at(file, index));
    }
    assert.deepEqual(duplicates, [], `duplicate ids:\n${duplicates.join("\n")}`);

    // label[for=…] must point at something, and we index them by target id.
    const labelsFor = new Map();
    for (const { token, index } of findElements(tokens, (t) => t.name === "label")) {
      const target = attr(token, "for");
      if (target === null) continue;
      assert.ok(
        ids.has(target),
        `${at(file, index)}: <label for="${target}"> points at an id that does not exist on this page`,
      );
      labelsFor.set(target, (labelsFor.get(target) ?? 0) + 1);
    }

    // Walk with an element stack so a wrapping <label>Name <input></label> counts
    // as a label and does NOT false-fail.
    const stack = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (t.type === "close") {
        for (let j = stack.length - 1; j >= 0; j -= 1) {
          if (stack[j] === t.name) {
            stack.length = j;
            break;
          }
        }
        continue;
      }
      if (t.type !== "open") continue;

      const isControl = ["input", "textarea", "select"].includes(t.name);
      if (isControl) {
        const type = (attr(t, "type") ?? "text").toLowerCase();
        if (!(t.name === "input" && UNLABELLED_INPUT_TYPES.has(type))) {
          const id = attr(t, "id");
          const wrapped = stack.includes("label");
          const forCount = id !== null ? (labelsFor.get(id) ?? 0) : 0;
          const total = forCount + (wrapped ? 1 : 0);
          assert.equal(
            total,
            1,
            `${at(file, t.index)}: <${t.name}${id ? ` id="${id}"` : ""} type="${type}"> ` +
              `has ${total} label(s) (${forCount} via label[for], ${wrapped ? 1 : 0} via wrapping), expected exactly 1`,
          );
        }
      }

      if (!t.selfClosing) stack.push(t.name);
    }
  }
});


test("no page ships an unresolved TODO or placeholder marker", () => {
  // The coaching page carried a `TODO (Ory)` comment holding space for session
  // length, pricing and availability. A half-finished money page is worse than
  // no page, and an HTML comment is invisible in the browser — so assert it.
  const offenders = [];
  for (const page of PAGES) {
    const html = pageHtml(page);
    for (const pattern of [/TODO/i, /FIXME/i, /YOUR_FORM_ID/, /Lorem ipsum/i, /\bTBD\b/i, /coming soon/i]) {
      const hit = html.match(pattern);
      if (hit) offenders.push(`${page}: ${hit[0]}`);
    }
  }
  assert.deepStrictEqual(offenders, [], `unresolved placeholders shipped:\n  ${offenders.join("\n  ")}`);
});

test("every img has an alt attribute", () => {
  let total = 0;
  for (const file of PAGES) {
    for (const { token, index } of elements(file, "img")) {
      total += 1;
      assert.ok(
        attr(token, "alt") !== null,
        `${at(file, index)}: <img src="${attr(token, "src")}"> has no alt attribute ` +
          `(alt="" is fine for a decorative image, absent is not)`,
      );
    }
  }
  assert.ok(total > 0, "no <img> elements found on any page — the walk is not seeing them");
});
