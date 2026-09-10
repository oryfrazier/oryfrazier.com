/* tests/contact-handler.test.mjs — behaviour of api/contact.mjs's default export.
 *
 * The real handler is imported ONCE and driven through fake req/res objects with
 * globalThis.fetch stubbed, so nothing here touches the network. Node stdlib only.
 *
 * Two hooks make the file order-independent:
 *   - the three Resend env vars are snapshotted in before() and restored in
 *     afterEach(), so a case may delete or change them freely;
 *   - globalThis.fetch is replaced per case and restored in afterEach().
 *
 * The single import of the handler is deliberate: the env-sequencing case asserts
 * that the SAME module instance re-reads process.env on every invocation, which is
 * only meaningful without a fresh import per case.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import handler from "../api/contact.mjs";
import { flush } from "./helpers/form-harness.mjs";

/* ------------------------------------------------------------------ *
 * Constants mirroring the shipped contract
 * ------------------------------------------------------------------ */

const EM_DASH = "—";
const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "CONTACT_TO"];
const TEST_ENV = {
  RESEND_API_KEY: "test-key-123",
  EMAIL_FROM: "Ory Frazier <howdy@oryfrazier.com>",
  CONTACT_TO: "oryfrazier@gmail.com",
};

const VALID = { name: "Ada Lovelace", email: "ada@example.com", message: "Hello there" };

const REQUIRED = "Name, email, and message are required.";
const BAD_EMAIL = "That email address doesn't look right.";
const NOT_CONFIGURED = "The form isn't configured yet.";
const SEND_FAILED = "The message could not be sent.";

const URLENCODED = "application/x-www-form-urlencoded";

/* ------------------------------------------------------------------ *
 * Fake req / res
 * ------------------------------------------------------------------ */

/**
 * Build a fake req. `stream` (a Readable) is returned with method/headers glued on,
 * which is what an unparsed Vercel request looks like; otherwise `body` is used.
 * Pass `accept: null` or `contentType: null` to omit that header entirely.
 */
function makeReq({ method = "POST", accept = "application/json", contentType = URLENCODED, body, stream = null } = {}) {
  const headers = {};
  if (contentType !== null) headers["content-type"] = contentType;
  if (accept !== null) headers.accept = accept;
  if (stream) return Object.assign(stream, { method, headers });
  return { method, headers, body };
}

/** Records every res call the handler can make. */
function makeRes() {
  const res = {
    statusCalls: [],
    jsonCalls: [],
    redirectCalls: [],
    headerCalls: [],
    setHeader(name, value) {
      res.headerCalls.push([name, value]);
      return res;
    },
    status(code) {
      res.statusCalls.push(code);
      return {
        json(payload) {
          res.jsonCalls.push(payload);
          return res;
        },
      };
    },
    redirect(status, location) {
      res.redirectCalls.push([status, location]);
      return res;
    },
    get statusCode() {
      return res.statusCalls.at(-1);
    },
    get body() {
      return res.jsonCalls.at(-1);
    },
    get error() {
      return res.jsonCalls.at(-1) && res.jsonCalls.at(-1).error;
    },
  };
  return res;
}

/** Drive the real handler once and hand back the recorded res. */
async function call(reqInit) {
  const res = makeRes();
  await handler(makeReq(reqInit), res);
  return res;
}

/* ------------------------------------------------------------------ *
 * fetch stub
 * ------------------------------------------------------------------ */

function resendOk(body = { id: "re_test" }) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let fetchSpy = null;

/** Install a fetch spy. `impl(url, init)` may return or throw; default is a 200 from Resend. */
function useFetch(impl = null) {
  const calls = [];
  const spy = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve().then(() => (impl ? impl(url, init) : resendOk()));
  };
  spy.calls = calls;
  globalThis.fetch = spy;
  fetchSpy = spy;
  return spy;
}

/** The JSON body of the nth (default first) Resend request. */
function payloadOf(spy = fetchSpy, index = 0) {
  return JSON.parse(spy.calls[index].init.body);
}

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

const savedEnv = {};
let realFetch;
let realConsoleError;
let consoleErrors = [];

before(() => {
  realFetch = globalThis.fetch;
  realConsoleError = console.error;
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

beforeEach(() => {
  Object.assign(process.env, TEST_ENV);
  useFetch(null);
  consoleErrors = [];
  // The handler logs on every failure path; keep the runner's output readable
  // while still making the log inspectable.
  console.error = (...args) => consoleErrors.push(args);
});

afterEach(() => {
  console.error = realConsoleError;
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

after(() => {
  console.error = realConsoleError;
  globalThis.fetch = realFetch;
});

/* ------------------------------------------------------------------ *
 * 1. Body shapes
 * ------------------------------------------------------------------ */

describe("readBody accepts every body shape Vercel can deliver", () => {
  it("(a) a pre-parsed object — the path Vercel actually takes in production", async () => {
    const spy = useFetch();
    const res = await call({ body: { ...VALID } });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(res.redirectCalls.length, 0);
    assert.equal(spy.calls.length, 1);
  });

  it("(b) an undrained urlencoded stream — the no-JS submission path", async () => {
    const spy = useFetch();
    const res = await call({
      stream: Readable.from([Buffer.from("name=Ory+Frazier&email=a%40b.co&message=hi")]),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(spy.calls.length, 1);

    const payload = payloadOf(spy);
    assert.equal(payload.subject, `oryfrazier.com ${EM_DASH} Ory Frazier`);
    assert.match(payload.text, /^Name: Ory Frazier$/m);
    assert.equal(payload.reply_to, "a@b.co");
  });

  it("(c) a raw Buffer — what Vercel hands back for an unrecognised content type", async () => {
    const spy = useFetch();
    const res = await call({ body: Buffer.from("name=x&email=a@b.co&message=hi") });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(spy.calls.length, 1);
    assert.equal(payloadOf(spy).reply_to, "a@b.co");
  });

  it("(d) a raw string, on an already-drained stream", async () => {
    const spy = useFetch();
    const res = await call({ body: "name=x&email=a@b.co&message=hi" });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(spy.calls.length, 1);
    assert.equal(payloadOf(spy).reply_to, "a@b.co");
  });
});

/* ------------------------------------------------------------------ *
 * 2. Honeypot
 * ------------------------------------------------------------------ */

describe("the honeypot short-circuits before any network call", () => {
  it("reports success to a JSON client without sending", async () => {
    const spy = useFetch();
    const res = await call({ body: { ...VALID, _gotcha: "x" } });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(spy.calls.length, 0);
  });

  it("redirects a no-JS client to /thanks without sending", async () => {
    const spy = useFetch();
    const res = await call({ accept: null, body: { ...VALID, _gotcha: "x" } });

    assert.deepEqual(res.redirectCalls, [[303, "/thanks"]]);
    assert.equal(res.statusCalls.length, 0);
    assert.equal(spy.calls.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Content negotiation
 * ------------------------------------------------------------------ */

describe("content negotiation", () => {
  it("a JSON client gets a JSON error and never a redirect", async () => {
    const res = await call({ body: { email: VALID.email, message: VALID.message } });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: REQUIRED });
    assert.equal(res.redirectCalls.length, 0);
  });

  it("a no-JS client gets a 303 back to /contact carrying the message", async () => {
    const res = await call({ accept: null, body: { email: VALID.email, message: VALID.message } });

    assert.deepEqual(res.redirectCalls, [[303, "/contact?error=Name%2C%20email%2C%20and%20message%20are%20required."]]);
    assert.equal(res.statusCalls.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Validation
 * ------------------------------------------------------------------ */

describe("validation failures never reach the network", () => {
  const rejects = [
    ["name missing", { email: VALID.email, message: VALID.message }, 400, REQUIRED],
    ["name whitespace-only", { ...VALID, name: "   " }, 400, REQUIRED],
    ["email missing", { name: VALID.name, message: VALID.message }, 400, REQUIRED],
    ["email whitespace-only", { ...VALID, email: " \t " }, 400, REQUIRED],
    ["message missing", { name: VALID.name, email: VALID.email }, 400, REQUIRED],
    ["message whitespace-only", { ...VALID, message: "\n  " }, 400, REQUIRED],
    ["email 'nope'", { ...VALID, email: "nope" }, 400, BAD_EMAIL],
    ["email 'a@b' (no dot)", { ...VALID, email: "a@b" }, 400, BAD_EMAIL],
    ["email 'a b@c.de' (space)", { ...VALID, email: "a b@c.de" }, 400, BAD_EMAIL],
    ["name at 201 chars", { ...VALID, name: "a".repeat(201) }, 400, "name is too long."],
    ["pronouns at 101 chars", { ...VALID, pronouns: "p".repeat(101) }, 400, "pronouns is too long."],
    ["email at 321 chars", { ...VALID, email: `${"a".repeat(316)}@b.co` }, 400, "email is too long."],
    ["message at 10001 chars", { ...VALID, message: "m".repeat(10001) }, 400, "message is too long."],
  ];

  for (const [label, body, status, message] of rejects) {
    it(`rejects ${label} with no fetch call`, async () => {
      const spy = useFetch();
      const res = await call({ body });

      assert.equal(res.statusCode, status);
      assert.deepEqual(res.body, { error: message });
      // Load-bearing: a `return fail(...)` losing its `return` still sets the
      // status, sends the email anyway, and only blows up in production.
      assert.equal(spy.calls.length, 0);
    });
  }

  it("accepts a name at exactly the 200-char cap", async () => {
    const spy = useFetch();
    const name = "a".repeat(200);
    const res = await call({ body: { ...VALID, name } });

    assert.equal(res.statusCode, 200);
    assert.equal(spy.calls.length, 1);
    assert.equal(payloadOf(spy).subject, `oryfrazier.com ${EM_DASH} ${name}`);
  });

  it("accepts a message at exactly the 10000-char cap", async () => {
    const spy = useFetch();
    const message = "m".repeat(10000);
    const res = await call({ body: { ...VALID, message } });

    assert.equal(res.statusCode, 200);
    assert.equal(spy.calls.length, 1);
    assert.ok(payloadOf(spy).text.includes(message));
  });

  it("keeps the email regex permissive: plus-addressing and a long TLD chain", async () => {
    const spy = useFetch();
    const res = await call({ body: { ...VALID, email: "  a+tag@sub.domain.co.uk  " } });

    assert.equal(res.statusCode, 200);
    assert.equal(spy.calls.length, 1);
    assert.equal(payloadOf(spy).reply_to, "a+tag@sub.domain.co.uk");
  });
});

/* ------------------------------------------------------------------ *
 * 5. Environment
 * ------------------------------------------------------------------ */

describe("missing Resend configuration", () => {
  for (const key of ENV_KEYS) {
    it(`returns 500 and sends nothing when ${key} is absent`, async () => {
      const spy = useFetch();
      delete process.env[key];
      const res = await call({ body: { ...VALID } });

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, { error: NOT_CONFIGURED });
      assert.equal(spy.calls.length, 0);
    });
  }

  it("re-reads process.env on every invocation, not once at module load", async () => {
    const spy = useFetch();
    for (const key of ENV_KEYS) delete process.env[key];

    const first = await call({ body: { ...VALID } });
    assert.equal(first.statusCode, 500);
    assert.equal(spy.calls.length, 0);

    Object.assign(process.env, TEST_ENV);

    // Same already-imported module instance: this is the whole point.
    const second = await call({ body: { ...VALID } });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.body, { ok: true });
    assert.equal(spy.calls.length, 1);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Resend request shape
 * ------------------------------------------------------------------ */

describe("the Resend request is the REST shape, not the node SDK shape", () => {
  it("posts to the REST endpoint with reply_to (never replyTo)", async () => {
    const spy = useFetch();
    const res = await call({ body: { ...VALID } });

    assert.equal(res.statusCode, 200);
    assert.equal(spy.calls.length, 1);

    const { url, init } = spy.calls[0];
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, `Bearer ${TEST_ENV.RESEND_API_KEY}`);
    assert.equal(init.headers["Content-Type"], "application/json");

    const payload = payloadOf(spy);
    assert.equal(payload.from, TEST_ENV.EMAIL_FROM);
    assert.deepEqual(payload.to, [TEST_ENV.CONTACT_TO]);
    assert.equal(payload.subject, `oryfrazier.com ${EM_DASH} ${VALID.name}`);
    // Resend's REST API takes reply_to; the node SDK takes replyTo and Resend
    // silently drops the unknown key, so Reply goes to Ory instead of the sender.
    assert.ok(Object.hasOwn(payload, "reply_to"), "payload must carry reply_to");
    assert.ok(!Object.hasOwn(payload, "replyTo"), "payload must not carry the SDK's replyTo");
    assert.equal(payload.reply_to, VALID.email);
  });
});

/* ------------------------------------------------------------------ *
 * 7. Escaping and paragraphs
 * ------------------------------------------------------------------ */

describe("the html part", () => {
  it("escapes exactly once and leaves the text part raw", async () => {
    const spy = useFetch();
    const message = '<b>&"x"</b>';
    const res = await call({ body: { ...VALID, message } });

    assert.equal(res.statusCode, 200);
    const payload = payloadOf(spy);

    assert.ok(payload.html.includes("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;"), payload.html);
    // Reordering the .replace chain so & is handled last double-escapes everything.
    assert.ok(!payload.html.includes("&amp;lt;"), "message must not be double-escaped");
    assert.ok(payload.text.includes(message), "the text part carries the raw message");
  });

  it("keeps blank-line paragraph breaks visible as markup", async () => {
    const spy = useFetch();
    const res = await call({ body: { ...VALID, message: "para one\n\npara two" } });

    assert.equal(res.statusCode, 200);
    const payload = payloadOf(spy);

    assert.ok(payload.text.includes("para one\n\npara two"), payload.text);

    // A literal newline inside a <p> is collapsed by every mail client: the break
    // has to survive as markup, not whitespace.
    assert.doesNotMatch(payload.html, /<p>[^<]*\n/);
    const start = payload.html.indexOf("para one") + "para one".length;
    const gap = payload.html.slice(start, payload.html.indexOf("para two"));
    assert.match(gap, /<\/p>\s*<p>|<br\s*\/?>/, `no paragraph break rendered: ${JSON.stringify(payload.html)}`);
  });
});

/* ------------------------------------------------------------------ *
 * 8. Optional pronouns and _source
 * ------------------------------------------------------------------ */

describe("optional fields", () => {
  it("omits the Pronouns line entirely when the field is absent", async () => {
    const spy = useFetch();
    const res = await call({ body: { ...VALID } });

    assert.equal(res.statusCode, 200);
    const lines = payloadOf(spy).text.split("\n");
    assert.equal(lines.filter((line) => line.startsWith("Pronouns:")).length, 0);
  });

  it("writes exactly one Pronouns line, above the Email line", async () => {
    const spy = useFetch();
    const res = await call({ body: { ...VALID, pronouns: "they/them" } });

    assert.equal(res.statusCode, 200);
    const lines = payloadOf(spy).text.split("\n");
    const pronouns = lines.filter((line) => line.startsWith("Pronouns:"));
    assert.deepEqual(pronouns, ["Pronouns: they/them"]);
    assert.ok(
      lines.indexOf("Pronouns: they/them") < lines.findIndex((line) => line.startsWith("Email:")),
      "Pronouns must appear before Email",
    );
  });

  it("labels the origin from _source, defaulting anything but 'home' to the contact page", async () => {
    const table = [
      ["home", "home page"],
      ["contact", "contact page"],
      ["bogus", "contact page"],
      [undefined, "contact page"],
    ];

    for (const [source, label] of table) {
      const spy = useFetch();
      const body = { ...VALID };
      if (source !== undefined) body._source = source;
      const res = await call({ body });

      assert.equal(res.statusCode, 200);
      assert.ok(
        payloadOf(spy).text.endsWith(`${EM_DASH} sent from the ${label} at oryfrazier.com`),
        `_source ${JSON.stringify(source)} should say "${label}": ${JSON.stringify(payloadOf(spy).text.slice(-60))}`,
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * 9. Failed sends
 * ------------------------------------------------------------------ */

describe("a failed send never reports success", () => {
  it("turns a non-ok Resend response into a 502", async () => {
    const spy = useFetch(() => ({ ok: false, status: 422, text: async () => "bad domain" }));
    const res = await call({ body: { ...VALID } });

    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { error: SEND_FAILED });
    assert.equal(spy.calls.length, 1);
  });

  it("turns a rejected fetch into a 502", async () => {
    const spy = useFetch(() => {
      throw new TypeError("fetch failed");
    });
    const res = await call({ body: { ...VALID } });

    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { error: SEND_FAILED });
    assert.equal(spy.calls.length, 1);
  });

  it("still 502s when response.text() rejects, with no unhandled rejection", async () => {
    const seen = [];
    const onUnhandled = (reason) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const spy = useFetch(() => ({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error("connection closed")),
      }));
      const res = await call({ body: { ...VALID } });
      // unhandledRejection is emitted a turn later; flush before asserting on it.
      await flush();

      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, { error: SEND_FAILED });
      assert.equal(spy.calls.length, 1);
      assert.deepEqual(seen, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 10. Method guard
 * ------------------------------------------------------------------ */

describe("non-POST requests", () => {
  it("answers GET with 405 and Allow: POST, sending nothing", async () => {
    const spy = useFetch();
    const res = await call({ method: "GET", body: undefined });

    assert.deepEqual(res.headerCalls, [["Allow", "POST"]]);
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { error: "Method not allowed" });
    assert.equal(res.redirectCalls.length, 0);
    assert.equal(spy.calls.length, 0);
  });

  it("stays JSON for a browser GET with no Accept header (pinned, not incidental)", async () => {
    const res = await call({ method: "GET", accept: null, contentType: null, body: undefined });

    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { error: "Method not allowed" });
    assert.equal(res.redirectCalls.length, 0);
  });
});
