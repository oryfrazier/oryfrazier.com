/* tests/deploy-config.test.mjs — how the site is SERVED and CRAWLED.
 *
 * vercel.json, sitemap.xml, robots.txt, canonicals, og:url, noindex, and every
 * own-domain absolute URL. Split out of the page tests because this group has a
 * single owner ("how the site is served and crawled"), fails as a unit whenever
 * the www/cleanUrls decision changes, and is the group whose failures a
 * maintainer most wants to read together.
 *
 * Offline: reads files from disk only. No network, no npm, no build step.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  attr,
  exists,
  pageFiles,
  pagePath,
  read,
  resolveHref,
  stripQuery,
  tokenize,
  vercelConfig,
} from "./helpers/repo.mjs";

/* ------------------------------------------------------------------ *
 * Local helpers — head-tag extraction over the shared token stream.
 * ------------------------------------------------------------------ */

/** The one hostname the whole site agrees on. The apex 308s to it. */
const ORIGIN = "https://www.oryfrazier.com";

const tokenCache = new Map();
function tokensFor(file) {
  if (!tokenCache.has(file)) tokenCache.set(file, tokenize(read(file)));
  return tokenCache.get(file);
}

/** Every <meta name="…"> content value on a page, in document order. */
function metaByName(file, name) {
  const want = name.toLowerCase();
  return tokensFor(file)
    .filter((t) => t.type === "open" && t.name === "meta" && (attr(t, "name") || "").toLowerCase() === want)
    .map((t) => attr(t, "content") ?? "");
}

/** Every <meta property="…"> content value on a page, in document order. */
function metaByProperty(file, property) {
  const want = property.toLowerCase();
  return tokensFor(file)
    .filter((t) => t.type === "open" && t.name === "meta" && (attr(t, "property") || "").toLowerCase() === want)
    .map((t) => attr(t, "content") ?? "");
}

/** Every <link rel="…"> href on a page, in document order. */
function linkByRel(file, rel) {
  const want = rel.toLowerCase();
  return tokensFor(file)
    .filter((t) => t.type === "open" && t.name === "link" && (attr(t, "rel") || "").toLowerCase() === want)
    .map((t) => attr(t, "href") ?? "");
}

/** Every <title> text node on a page. <title> is raw-text, so the text follows the open token. */
function titleTexts(file) {
  const tokens = tokensFor(file);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "open" || tokens[i].name !== "title") continue;
    const next = tokens[i + 1];
    out.push(next && next.type === "text" ? next.text : "");
  }
  return out;
}

const first = (values) => (values.length > 0 ? values[0] : null);

const canonicalOf = (file) => first(linkByRel(file, "canonical"));
const ogUrlOf = (file) => first(metaByProperty(file, "og:url"));

/** True when the page carries a robots meta asking search engines to stay away. */
function isNoindex(file) {
  return metaByName(file, "robots").some((v) => /\bnoindex\b/i.test(v));
}

const indexablePages = () => pageFiles().filter((f) => !isNoindex(f));
const noindexPages = () => pageFiles().filter((f) => isNoindex(f));

/** The canonical URL a page SHOULD have, derived from its filename under cleanUrls. */
const expectedCanonical = (file) => ORIGIN + pagePath(file);

/* ------------------------------------------------------------------ *
 * vercel.json helpers
 * ------------------------------------------------------------------ */

function headerRules() {
  const config = vercelConfig();
  return Array.isArray(config.headers) ? config.headers : [];
}

/** Case-insensitive header lookup within one vercel.json header rule. */
function headerValue(rule, key) {
  const want = key.toLowerCase();
  const hit = (rule.headers || []).find((h) => String(h.key).toLowerCase() === want);
  return hit ? String(hit.value) : null;
}

function ruleForSource(fragment) {
  return headerRules().find((r) => String(r.source).includes(fragment)) || null;
}

/** Every max-age / s-maxage number declared in a Cache-Control value, both spellings. */
function maxAges(value) {
  return [...String(value).matchAll(/\b(?:s-maxage|s-max-age|max-age)\s*=\s*(\d+)/gi)].map((m) => Number(m[1]));
}

/* ------------------------------------------------------------------ *
 * Cases
 * ------------------------------------------------------------------ */

test("vercel.json still encodes the caching scheme the ?v= mechanism depends on", () => {
  const config = vercelConfig();

  // The cleanUrls/trailingSlash pair is what makes every canonical derivation in
  // this file valid: /about is served from about.html with no trailing slash.
  assert.equal(config.cleanUrls, true, "vercel.json must set cleanUrls: true");
  assert.equal(config.trailingSlash, false, "vercel.json must set trailingSlash: false");

  // CSS and JS carry no filename fingerprint — the ?v=N query IS the entire
  // cache-bust mechanism, and it only works if the browser revalidates.
  const codeRule = ruleForSource("(css|js)");
  assert.ok(codeRule, "no header rule targets /assets/(css|js)/ — the ?v= bump would stop working");
  const codeCache = headerValue(codeRule, "Cache-Control");
  assert.ok(codeCache, `the ${codeRule.source} rule sets no Cache-Control`);
  assert.match(codeCache, /\bmax-age\s*=\s*0\b/, `css/js Cache-Control must be max-age=0, got: ${codeCache}`);
  assert.match(codeCache, /\bmust-revalidate\b/, `css/js Cache-Control must be must-revalidate, got: ${codeCache}`);
  assert.doesNotMatch(
    codeCache,
    /\bimmutable\b/,
    `immutable on an unfingerprinted path makes a bad ?v= bump unrecoverable for the whole max-age: ${codeCache}`,
  );
  for (const age of maxAges(codeCache)) {
    assert.equal(age, 0, `every max-age/s-maxage on css/js must be 0, got: ${codeCache}`);
  }

  // Fonts and images ARE effectively immutable — their names change when they do.
  const assetRule = ruleForSource("(fonts|img)");
  assert.ok(assetRule, "no header rule targets /assets/(fonts|img)/");
  const assetCache = headerValue(assetRule, "Cache-Control");
  assert.ok(assetCache, `the ${assetRule.source} rule sets no Cache-Control`);
  assert.match(assetCache, /\bimmutable\b/, `fonts/img should be immutable, got: ${assetCache}`);
  const assetAges = maxAges(assetCache);
  assert.ok(assetAges.length > 0, `fonts/img Cache-Control declares no max-age: ${assetCache}`);
  for (const age of assetAges) {
    assert.ok(age >= 31536000, `fonts/img max-age should be a year or more, got ${age} in: ${assetCache}`);
  }

  // Nothing outside /assets/ may set Cache-Control: an HTML rule would pin pages
  // to a cached copy and the ?v= bump would never reach the visitor at all.
  for (const rule of headerRules()) {
    if (String(rule.source).startsWith("/assets/")) continue;
    assert.equal(
      headerValue(rule, "Cache-Control"),
      null,
      `header rule ${rule.source} sets Cache-Control outside /assets/ — HTML must never be cached`,
    );
  }

  // Presence, not an exact key set: adding Permissions-Policy must not fail here.
  const catchAll = headerRules().find((r) => /^\/(\(\.\*\)|:path\*)$/.test(String(r.source)));
  assert.ok(catchAll, "no catch-all header rule — the security headers apply to nothing");
  for (const key of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options"]) {
    assert.ok(headerValue(catchAll, key), `the ${catchAll.source} rule is missing ${key}`);
  }
});

test("canonical === og:url === the path derived from the filename under cleanUrls", () => {
  const files = indexablePages();
  assert.ok(files.length > 0, "no indexable pages found — the noindex detection is probably broken");

  for (const file of files) {
    const expected = expectedCanonical(file);
    assert.equal(canonicalOf(file), expected, `${file}: <link rel="canonical"> does not match its own path`);
    assert.equal(ogUrlOf(file), expected, `${file}: og:url does not match its own path`);
  }
});

test("each head tag appears exactly once, and description/title agree with their og twins", () => {
  for (const file of indexablePages()) {
    const description = metaByName(file, "description");
    const ogDescription = metaByProperty(file, "og:description");
    const title = titleTexts(file);
    const ogTitle = metaByProperty(file, "og:title");

    // Raw UTF-8, no entity normalisation: the files carry literal em dashes and
    // curly apostrophes and the two copies must be byte-identical.
    assert.equal(
      description[0],
      ogDescription[0],
      `${file}: meta description and og:description have drifted — the og copy is what every share shows`,
    );
    assert.equal(title[0], ogTitle[0], `${file}: <title> and og:title have drifted`);

    // Exactly once each. Two canonicals means Google picks one unpredictably.
    const counts = [
      ["<title>", title],
      ['meta name="description"', description],
      ['link rel="canonical"', linkByRel(file, "canonical")],
      ["og:type", metaByProperty(file, "og:type")],
      ["og:title", ogTitle],
      ["og:description", ogDescription],
      ["og:url", metaByProperty(file, "og:url")],
      ["og:image", metaByProperty(file, "og:image")],
      ["twitter:card", metaByName(file, "twitter:card")],
    ];
    for (const [label, values] of counts) {
      assert.equal(values.length, 1, `${file}: expected exactly one ${label}, found ${values.length}`);
      assert.notEqual(values[0].trim(), "", `${file}: ${label} is empty`);
    }
  }
});

test("the sitemap's <loc> set equals the canonicals of the non-noindex pages, and robots agrees", () => {
  // Derived, never hardcoded: an eighth page is covered the moment it is added,
  // and a hardcoded count would be the stale-count bug in test form.
  const expected = indexablePages().map(canonicalOf).sort();

  const sitemap = read("sitemap.xml");
  const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].trim()).sort();

  assert.deepEqual(
    locs,
    expected,
    "sitemap.xml <loc> set does not match the canonicals of the indexable pages " +
      "(byte-exact: the home entry keeps its trailing slash, the others have none)",
  );

  const sitemapLine = /^\s*Sitemap:\s*(\S+)\s*$/m.exec(read("robots.txt"));
  assert.ok(sitemapLine, "robots.txt has no Sitemap: line");
  const homeOrigin = new URL(canonicalOf("index.html")).origin;
  assert.equal(
    sitemapLine[1],
    `${homeOrigin}/sitemap.xml`,
    "robots.txt's Sitemap: line must use the same origin as the canonicals — " +
      "an apex or http URL there makes Google ignore the sitemap",
  );
});

test("noindex is on exactly 404 and thanks, and those pages carry no canonical or og:url", () => {
  assert.deepEqual(
    noindexPages(),
    ["404.html", "thanks.html"],
    "the set of noindex pages changed — losing it indexes a thin page, gaining it deindexes a real one",
  );

  const sitemap = read("sitemap.xml");
  const locs = new Set([...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].trim()));

  for (const file of noindexPages()) {
    assert.equal(canonicalOf(file), null, `${file} is noindex but declares a canonical`);
    assert.equal(ogUrlOf(file), null, `${file} is noindex but declares an og:url`);
    assert.ok(!locs.has(expectedCanonical(file)), `${file} is noindex but is listed in sitemap.xml`);
  }
});

test("every own-domain absolute URL is https://www.oryfrazier.com", () => {
  // Raw-text scan, so one pass covers the sitemap's <loc> entries and robots'
  // Sitemap: line alongside every canonical, og:url and og:image.
  const sources = [...pageFiles(), "sitemap.xml", "robots.txt"];
  for (const file of sources) {
    const text = read(file);
    for (const match of text.matchAll(/https?:\/\/[^"'\s<>]*oryfrazier\.com[^"'\s<>]*/g)) {
      assert.ok(
        match[0].startsWith(ORIGIN),
        `${file}: ${match[0]} is not on ${ORIGIN} — the apex 308s to www, so this points the crawler at a redirect`,
      );
    }
  }

  // og:image is the one asset reference no human ever sees fail: it renders in
  // someone else's Slack, not in the browser.
  for (const file of pageFiles()) {
    for (const url of metaByProperty(file, "og:image")) {
      // Absolute and on our own origin: crawlers do not resolve relative og:image
      // URLs, and the slice below is only sound once this holds.
      assert.ok(url.startsWith(`${ORIGIN}/`), `${file}: og:image must be an absolute ${ORIGIN} URL, got: ${url}`);
      const rel = stripQuery(url.slice(ORIGIN.length)).replace(/^\/+/, "");
      assert.ok(exists(rel), `${file}: og:image ${url} does not resolve to a file on disk (looked for ${rel})`);
    }
  }
});

test("no internal link is shadowed by a redirect, and no redirect source has a real file", (t) => {
  const config = vercelConfig();
  const redirects = Array.isArray(config.redirects) ? config.redirects : [];
  if (redirects.length === 0) {
    // No redirects means nothing can be shadowed. Vacuously true, and correctly so.
    t.diagnostic("vercel.json declares no redirects — nothing to shadow");
    return;
  }

  // Collect every internal reference on every page once.
  const refs = [];
  for (const file of pageFiles()) {
    for (const token of tokensFor(file)) {
      if (token.type !== "open") continue;
      for (const key of ["href", "src", "action"]) {
        const raw = attr(token, key);
        if (!raw) continue;
        const resolved = resolveHref(raw, { fromFile: file });
        if (resolved.kind === "internal") refs.push({ file, raw, path: resolved.path });
      }
    }
  }

  let checked = 0;
  for (const redirect of redirects) {
    const source = String(redirect.source);

    // `href === source` string equality is only meaningful for literal sources.
    // Say so out loud rather than silently passing on a path-to-regexp pattern.
    if (/[:(*?[\]]/.test(source)) {
      t.diagnostic(`skipping pattern redirect source ${source}: only literal sources can be string-compared`);
      continue;
    }
    checked += 1;

    for (const ref of refs) {
      assert.notEqual(
        ref.path,
        source,
        `${ref.file} links to ${ref.raw}, which vercel.json redirects (${source} -> ${redirect.destination}) ` +
          "— every click burns a redirect hop; link the destination instead",
      );
    }

    const shadowed = `${source.replace(/^\/+/, "")}.html`;
    assert.ok(
      !exists(shadowed),
      `${shadowed} exists on disk but ${source} is redirected to ${redirect.destination}` +
        `${redirect.permanent ? " permanently" : ""} — the file can never be reached`,
    );
  }

  // Redirects exist but none is literal: the string-equality approximation no longer
  // covers the risk, and a green result here would be a lie. Fail loudly so the check
  // gets strengthened (match hrefs against the compiled pattern) rather than rotting.
  assert.ok(
    checked > 0,
    `every redirect source is a path-to-regexp pattern (${redirects.map((r) => r.source).join(", ")}) — ` +
      "this case can no longer prove anything by string equality and needs a real pattern matcher",
  );
});

/* ------------------------------------------------------------------ *
 * The two paths pages.test.mjs cannot resolve from disk
 * ------------------------------------------------------------------ */

/**
 * pages.test.mjs exempts /_vercel/… and vercel.json rewrite sources from its
 * "does this resolve on disk" walk, because neither is a file in this repo.
 * These two cases are what stops that exemption from being a hole: a typo in
 * the analytics src, or a link at a slug api/go.mjs never defines, would
 * otherwise ship green and fail only in someone else's browser.
 */

const ANALYTICS_STUB =
  '<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};</script>';
const ANALYTICS_SRC = '<script defer src="/_vercel/insights/script.js"></script>';

test("every page carries the Vercel Web Analytics snippet, stub first, exactly once", () => {
  for (const file of pageFiles()) {
    const html = read(file);

    const stubs = html.split(ANALYTICS_STUB).length - 1;
    const srcs = html.split(ANALYTICS_SRC).length - 1;
    assert.equal(stubs, 1, `${file}: expected exactly one analytics queue stub, found ${stubs}`);
    assert.equal(srcs, 1, `${file}: expected exactly one analytics <script src>, found ${srcs}`);

    // Order matters: va(...) called before the real script loads throws unless
    // the queue stub is already defined.
    assert.ok(
      html.indexOf(ANALYTICS_STUB) < html.indexOf(ANALYTICS_SRC),
      `${file}: the analytics queue stub must come before the script that consumes it`,
    );
  }
});

test("every /go/<slug> link names a slug api/go.mjs defines, and the rewrite exists", async () => {
  const { DESTINATIONS } = await import("../api/go.mjs");

  const config = vercelConfig();
  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];
  const goRewrite = rewrites.find((rule) => String(rule.source).startsWith("/go/"));
  assert.ok(
    goRewrite,
    "vercel.json has no /go/ rewrite — every outbound link on /links would 404",
  );
  assert.equal(
    goRewrite.destination,
    "/api/go?slug=:slug",
    `the /go rewrite points at ${goRewrite.destination}, which is not the handler`,
  );
  assert.ok(exists("api/go.mjs"), "vercel.json rewrites /go/ onto api/go.mjs, which is not on disk");

  const linked = new Set();
  for (const file of pageFiles()) {
    for (const match of read(file).matchAll(/href="\/go\/([^"?#]+)"/g)) {
      linked.add(match[1]);
    }
  }
  assert.ok(linked.size > 0, "no /go/<slug> links found on any page — the walk is not seeing them");

  const unknown = [...linked].filter((slug) => !Object.hasOwn(DESTINATIONS, slug)).sort();
  assert.deepEqual(
    unknown,
    [],
    `these slugs are linked but not defined in api/go.mjs, so they redirect to the ` +
      `fallback instead of the destination: ${unknown.join(", ")}`,
  );

  // Every destination is an absolute off-site URL. A relative Location would
  // make the redirect loop back into this site.
  for (const [slug, url] of Object.entries(DESTINATIONS)) {
    assert.match(url, /^https:\/\//, `api/go.mjs: ${slug} -> ${url} is not an absolute https URL`);
  }
});
