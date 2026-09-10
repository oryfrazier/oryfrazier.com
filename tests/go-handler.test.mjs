/* tests/go-handler.test.mjs — api/go.mjs, the outbound click counter.
 *
 * The handler is the only thing standing between a click on /links and the
 * destination, so every branch of it is a way to break an outbound link on a
 * page whose entire job is outbound links. The cases below are the ways it can
 * fail while still looking fine: a cached redirect that stops counting, a 301
 * that can never be changed, an unknown slug that dead-ends the visitor.
 *
 * Offline: imports the module and calls it with a fake req/res. No network.
 */

import assert from "node:assert/strict";
import test from "node:test";

import handler, { DESTINATIONS, FALLBACK, slugFrom } from "../api/go.mjs";

/** A minimal stand-in for Vercel's response object. */
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    ended: false,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end() {
      this.ended = true;
    },
  };
}

/** Run the handler with console.log captured, returning { res, logs }. */
function run(req) {
  const res = fakeRes();
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(line);
  try {
    handler(req, res);
  } finally {
    console.log = original;
  }
  return { res, logs };
}

test("the destination table is non-empty and every entry is an off-site https URL", () => {
  const entries = Object.entries(DESTINATIONS);
  assert.ok(entries.length > 0, "DESTINATIONS is empty — every /go/ link would hit the fallback");
  for (const [slug, url] of entries) {
    assert.match(slug, /^[a-z0-9-]+$/, `slug ${JSON.stringify(slug)} is not url-safe lowercase`);
    assert.match(url, /^https:\/\//, `${slug} -> ${url} is not an absolute https URL`);
  }
});

test("a known slug redirects to its destination", () => {
  for (const [slug, url] of Object.entries(DESTINATIONS)) {
    const { res } = run({ query: { slug }, headers: {} });
    assert.equal(res.statusCode, 302, `${slug}: expected a 302`);
    assert.equal(res.headers.location, url, `${slug}: wrong Location`);
    assert.ok(res.ended, `${slug}: the response was never ended`);
  }
});

test("the redirect is 302 and uncacheable, so clicks keep being counted", () => {
  const slug = Object.keys(DESTINATIONS)[0];
  const { res } = run({ query: { slug }, headers: {} });

  // 301 is cached by the browser indefinitely: the second click never reaches
  // the function, the count flatlines, and the destination can never change.
  assert.notEqual(res.statusCode, 301, "a permanent redirect stops the counting it exists to do");
  assert.equal(res.statusCode, 302);
  assert.equal(
    res.headers["cache-control"],
    "no-store",
    "without no-store the CDN serves the hop and the function stops seeing clicks",
  );
});

test("an unknown or missing slug lands on the links page rather than a 404", () => {
  for (const req of [
    { query: { slug: "does-not-exist" }, headers: {} },
    { query: {}, headers: {} },
    { headers: {} },
  ]) {
    const { res } = run(req);
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, FALLBACK);
  }
});

test("the slug is read from the raw URL when the platform has not parsed a query", () => {
  const slug = Object.keys(DESTINATIONS)[0];
  assert.equal(slugFrom({ url: `/go/${slug}` }), slug);
  assert.equal(slugFrom({ url: `/api/go?slug=${slug}` }), slug);
  assert.equal(slugFrom({ url: "/go/" }), "");
  assert.equal(slugFrom({}), "");

  // A slug that arrives percent-encoded or shouted still resolves.
  assert.equal(slugFrom({ url: "/go/SPOTIFY" }), "spotify");
  assert.equal(slugFrom({ url: "/go/ice%2Dcycles" }), "ice-cycles");
  // A malformed escape must not throw — it would 500 an outbound link.
  assert.doesNotThrow(() => slugFrom({ url: "/go/%E0%A4%A" }));
});

test("each click logs exactly one JSON line, and it carries no visitor identifier", () => {
  const slug = Object.keys(DESTINATIONS)[0];
  const { logs } = run({ query: { slug }, headers: { referer: "https://www.oryfrazier.com/links" } });

  assert.equal(logs.length, 1, `expected one log line per click, got ${logs.length}`);
  const entry = JSON.parse(logs[0]);
  assert.equal(entry.event, "outbound");
  assert.equal(entry.slug, slug);
  assert.equal(entry.to, DESTINATIONS[slug]);
  assert.equal(entry.referer, "https://www.oryfrazier.com/links");
  assert.ok(Number.isFinite(Date.parse(entry.at)), `at is not a timestamp: ${entry.at}`);

  // The site has no reason to hold either, and saying so in a test is what
  // stops one being added later "just for debugging".
  assert.equal(entry.ip, undefined, "the click log must not record an IP address");
  assert.equal(entry.userAgent, undefined, "the click log must not record a user agent");
});

test("an unknown slug is logged distinguishably, so a broken link is findable", () => {
  const { logs } = run({ query: { slug: "typo" }, headers: {} });
  const entry = JSON.parse(logs[0]);
  assert.equal(entry.event, "outbound_unknown_slug");
  assert.equal(entry.slug, "typo");
});
