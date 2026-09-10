/* tests/form-contract.test.mjs
 *
 * The four-way coupling between assets/js/form.js, the two forms in index.html and
 * contact.html, assets/css/style.css, and api/contact.mjs. Nothing in the repo links
 * these files, and every one of the shipped form bugs lived in a gap between them.
 *
 * This file deliberately mixes vm-harness behaviour with token-stream markup
 * assertions: the coupling IS the subject, and splitting it would recreate the seam
 * the file exists to close.
 *
 * TIMING — the single most likely way to make this file falsely green: form.js's
 * submit handler is NOT async and returns nothing. Its .then/.catch/.finally chain
 * resolves several ticks after the handler returns. Every assertion about
 * submit.disabled, the final textContent or form.reset() must come after
 * `await flush()` (a setImmediate turn, not `await null`). `submitForm()` from the
 * harness does that for you; the raw `submitHandler(event)` call does not.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import handler from "../api/contact.mjs";
import {
  attr,
  classTokens,
  cssBlocks,
  decl,
  findElements,
  lineOf,
  matchingClose,
  pageFiles,
  pageHtml,
  read,
  tokenize,
} from "./helpers/repo.mjs";
import { createHarness, makeResponse } from "./helpers/form-harness.mjs";

/* ------------------------------------------------------------------ *
 * Markup scraping
 * ------------------------------------------------------------------ */

/** Every .js-form in a page, with its controls, from the shared token stream. */
function formsIn(file) {
  const html = pageHtml(file);
  const tokens = tokenize(html);
  const found = findElements(tokens, (t) => t.name === "form" && classTokens(t).includes("js-form"));

  return found.map(({ token, index }) => {
    const close = matchingClose(tokens, index);
    const end = close === -1 ? tokens.length : close;
    const controls = [];
    for (let i = index + 1; i < end; i += 1) {
      const t = tokens[i];
      if (t.type !== "open") continue;
      if (!["input", "textarea", "select", "button"].includes(t.name)) continue;
      controls.push({
        tag: t.name,
        name: attr(t, "name"),
        type: (attr(t, "type") || "").toLowerCase(),
        value: attr(t, "value") ?? "",
        required: t.attrs.has("required"),
        token: t,
        line: lineOf(html, t.index),
      });
    }
    return { file, html, tokens, token, openIndex: index, endIndex: end, controls };
  });
}

/** Pages that carry at least one .js-form. Derived, never hardcoded. */
function formPages() {
  return pageFiles().filter((f) => formsIn(f).length > 0);
}

/** Named controls only (what a browser's FormData would serialise). */
function namedControls(form) {
  return form.controls.filter((c) => c.name && c.tag !== "button");
}

/* ------------------------------------------------------------------ *
 * Server-side driver: the REAL api/contact.mjs against fake req/res
 * ------------------------------------------------------------------ */

const ENV = {
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Ory Frazier <howdy@oryfrazier.com>",
  CONTACT_TO: "oryfrazier@gmail.com",
};

function makeReq({ method = "POST", headers = {}, bodyText = "" } = {}) {
  const req = Readable.from([Buffer.from(bodyText, "utf8")]);
  req.method = method;
  req.headers = {};
  for (const [k, v] of Object.entries(headers)) req.headers[k.toLowerCase()] = v;
  return req;
}

function makeRes() {
  const res = {
    statusCalls: [],
    jsonBodies: [],
    redirects: [],
    headers: {},
    setHeader(name, value) {
      res.headers[name] = value;
      return res;
    },
    status(code) {
      res.statusCalls.push(code);
      return res;
    },
    json(body) {
      res.jsonBodies.push(body);
      return res;
    },
    redirect(code, location) {
      res.redirects.push([code, location]);
      return res;
    },
  };
  return res;
}

const okResend = () => ({
  ok: true,
  status: 200,
  json: async () => ({ id: "resend-test-id" }),
  text: async () => "",
});

/**
 * POST `bodyText` through the real handler with globalThis.fetch stubbed and the
 * three Resend env vars set. Everything is restored in `finally`, so cases are
 * order-independent and the suite is env-independent.
 */
async function callHandler({ bodyText = "", headers = {}, method = "POST", resend = okResend } = {}) {
  const savedFetch = globalThis.fetch;
  const savedEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  const calls = [];

  Object.assign(process.env, ENV);
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return resend(url, init);
  };

  try {
    const req = makeReq({
      method,
      bodyText,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...headers,
      },
    });
    const res = makeRes();
    await handler(req, res);
    return {
      res,
      calls,
      payload: calls.length > 0 ? JSON.parse(calls[0].init.body) : null,
    };
  } finally {
    globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/* ================================================================== *
 * SEAM: real client output through real server input
 * ================================================================== */

test("SEAM: the bytes form.js actually sends are the bytes the real handler actually parses", async () => {
  // Values chosen to break naive serialisation: a space, a '+' that must survive as
  // a plus rather than decoding to a space, urlencoded metacharacters, and non-ASCII.
  const sample = {
    name: "Ory Frazier",
    pronouns: "they/them",
    email: "a+tag@b.co",
    message: "héllo — naïve ✓ a=b&c=d\n\nsecond paragraph with a + sign",
  };

  const h = createHarness({ page: "contact.html", sample });
  await h.submitForm();

  assert.equal(h.fetch.calls.length, 1, "form.js must POST exactly once per submit");
  const { init } = h.fetch.calls[0];
  assert.ok(
    init.body instanceof URLSearchParams,
    `form.js must send a URLSearchParams body; got ${init.body?.constructor?.name}`,
  );

  // The exact bytes a browser would put on the wire.
  const wire = String(init.body);
  const { res, payload } = await callHandler({ bodyText: wire });

  assert.deepEqual(res.statusCalls, [200], `handler rejected form.js's own body: ${wire}`);
  assert.deepEqual(res.jsonBodies, [{ ok: true }]);
  assert.deepEqual(res.redirects, [], "a JSON client must never be redirected");

  assert.equal(payload.reply_to, sample.email, "the '+' in the address must not decode to a space");
  assert.equal(payload.subject, `oryfrazier.com — ${sample.name}`);
  assert.ok(
    payload.text.includes(`Name: ${sample.name}`),
    `name lost in transit: ${JSON.stringify(payload.text)}`,
  );
  assert.ok(
    payload.text.includes(`Pronouns: ${sample.pronouns}`),
    `pronouns lost in transit: ${JSON.stringify(payload.text)}`,
  );
  assert.ok(
    payload.text.includes(sample.message),
    `message mangled in transit: ${JSON.stringify(payload.text)}`,
  );
});

test("SEAM: the markup's field names are the field names the handler honours", async (t) => {
  const pages = formPages();
  assert.ok(pages.length > 0, "no page carries a .js-form — the scraper is broken");

  const VALUES = {
    name: "Ada Lovelace",
    email: "ada+test@example.co.uk",
    message: "First paragraph.\n\nSecond paragraph.",
    pronouns: "she/her",
  };

  for (const file of pages) {
    for (const form of formsIn(file)) {
      const controls = namedControls(form);
      const names = controls.map((c) => c.name);

      await t.test(`${file}: every named control reaches the email`, async () => {
        const pairs = controls.map((c) => [c.name, Object.hasOwn(VALUES, c.name) ? VALUES[c.name] : c.value]);
        const bodyText = new URLSearchParams(pairs).toString();
        const { res, payload } = await callHandler({ bodyText });

        assert.deepEqual(res.statusCalls, [200], `handler rejected ${file}'s own field set: ${bodyText}`);

        for (const field of ["name", "email", "message", "pronouns"]) {
          if (!names.includes(field)) continue;
          assert.ok(
            payload.text.includes(VALUES[field]),
            `${file} posts "${field}" but its value never reaches the email body`,
          );
        }
        if (!names.includes("pronouns")) {
          assert.ok(
            !/^Pronouns:/m.test(payload.text),
            `${file} has no pronouns control, so the email must carry no Pronouns line`,
          );
        }

        // The hidden _source input is Ory's only conversion signal, and its VALUE
        // (not just its name) is what the handler switches on.
        const source = controls.find((c) => c.name === "_source");
        assert.ok(source, `${file}'s form must keep the hidden _source input`);
        const expected = source.value === "home" ? "home page" : "contact page";
        assert.ok(
          payload.text.endsWith(`— sent from the ${expected} at oryfrazier.com`),
          `${file} labels itself "${source.value}" but the email says otherwise: ${JSON.stringify(payload.text)}`,
        );
      });

      await t.test(`${file}: required attributes match the server's own guard`, () => {
        const required = controls.filter((c) => c.required).map((c) => c.name).sort();
        assert.deepEqual(
          required,
          ["email", "message", "name"],
          `${file}'s required set must equal the server's ` +
            "`if (!data.name || !data.email || !data.message)` guard. " +
            `Lines: ${controls.filter((c) => c.required).map((c) => `${c.name}@${c.line}`).join(", ")}`,
        );
      });

      await t.test(`${file}: blanking a required field is rejected server-side too`, async () => {
        const required = controls.filter((c) => c.required).map((c) => c.name);
        for (const blank of required) {
          const pairs = controls.map((c) => [
            c.name,
            c.name === blank ? "" : Object.hasOwn(VALUES, c.name) ? VALUES[c.name] : c.value,
          ]);
          const bodyText = new URLSearchParams(pairs).toString();
          const { res, calls } = await callHandler({ bodyText });

          assert.deepEqual(
            res.statusCalls,
            [400],
            `${file}: a blank "${blank}" is required in markup but accepted by the server`,
          );
          assert.equal(calls.length, 0, `${file}: a blank "${blank}" still hit the network`);
        }
      });
    }
  }
});

/* ================================================================== *
 * The client half
 * ================================================================== */

test("form.js posts urlencoded with the right headers", async () => {
  const h = createHarness();
  await h.submitForm();

  assert.equal(h.fetch.calls.length, 1);
  const { url, init } = h.fetch.calls[0];

  assert.equal(url, h.formAction, "form.js must post to the form's own action");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(init.headers.Accept, "application/json");
  assert.ok(
    init.body instanceof URLSearchParams,
    "a FormData body would go out as multipart, which the serverless runtime does not parse",
  );
  assert.deepEqual(
    [...new URLSearchParams(String(init.body))],
    h.fields.map(([k, v]) => [k, v]),
    "the serialised body must round-trip every field, in order",
  );

  // A markup property no vm test can observe: enctype changes what the no-JS
  // native POST sends, which is the whole fallback.
  for (const file of pageFiles()) {
    const tokens = tokenize(pageHtml(file));
    for (const { token } of findElements(tokens, (t) => t.name === "form")) {
      assert.equal(
        attr(token, "enctype"),
        null,
        `${file}: a <form enctype=…> changes the no-JS POST's content type`,
      );
    }
  }
});

test("the status node keeps its hook classes through success and error", async () => {
  const seeded = createHarness();
  // Detail 3: the class set comes from the shipped markup, not from a literal here.
  assert.deepEqual(
    [...seeded.status.classList].sort(),
    ["form__status", "js-form-status"],
    "contact.html's status paragraph must carry both hook classes to begin with",
  );

  const success = createHarness({ fetchImpl: () => makeResponse({ ok: true, body: { ok: true } }) });
  await success.submitForm();
  assert.ok(success.status.classList.contains("js-form-status"), "success path dropped the JS hook class");
  assert.ok(success.status.classList.contains("form__status"), "success path dropped the styling class");

  const failure = createHarness({
    fetchImpl: () => makeResponse({ ok: false, status: 400, body: { error: "That email address doesn't look right." } }),
  });
  await failure.submitForm();
  assert.ok(failure.status.classList.contains("js-form-status"), "error path dropped the JS hook class");
  assert.ok(failure.status.classList.contains("form__status"), "error path dropped the styling class");
});

test("error state clears on retry and the submit button always re-enables", async () => {
  let mode = "error";
  const serverMessage = "That email address doesn't look right.";
  const h = createHarness({
    fetchImpl: () =>
      mode === "error"
        ? makeResponse({ ok: false, status: 400, body: { error: serverMessage } })
        : makeResponse({ ok: true, status: 200, body: { ok: true } }),
  });

  // --- failed attempt, asserted mid-handler first ---
  const event = h.makeEvent();
  h.submitHandler(event);
  assert.equal(event.preventDefaultCalls, 1, "the native submit must be suppressed");
  assert.equal(h.status.textContent, "Sending…", "the pending state must be painted synchronously");
  assert.equal(h.submit.disabled, true, "the button must be disabled synchronously");

  await h.flush(); // WITHOUT THIS every assertion below reads pre-fetch state.

  assert.ok(h.status.classList.contains("form__status--error"), "a failed send must be styled as an error");
  assert.equal(h.status.textContent, serverMessage, "the server's own message must be shown");
  assert.equal(h.submit.disabled, false, "the button must re-enable after a failure or the visitor cannot retry");
  assert.equal(h.form.resetCalls, 0, "a failed send must not wipe what the visitor typed");

  // --- successful retry on the same nodes ---
  mode = "success";
  await h.submitForm();

  assert.ok(
    !h.status.classList.contains("form__status--error"),
    "'Thank you!' must not render in error red after a corrected retry",
  );
  assert.equal(h.status.textContent, "Thank you!");
  assert.equal(h.form.resetCalls, 1, "a successful send must clear the form exactly once");
  assert.equal(h.submit.disabled, false);
  assert.deepEqual(h.submit._disabledLog, [true, false, true, false], "disable/enable must pair on every attempt");
});

test("every status string rendered is non-empty", async () => {
  // style.css hides `.form__status:empty`, so any path that sets textContent to ""
  // re-enables the button and changes nothing else on screen.
  const paths = {
    success: () => makeResponse({ ok: true, status: 200, body: { ok: true } }),
    httpError: () => makeResponse({ ok: false, status: 400, body: { error: "Name, email, and message are required." } }),
    networkRejection: () => Promise.reject(new TypeError("Failed to fetch")),
    jsonRejects: () => makeResponse({ ok: false, status: 502, jsonRejects: true }),
  };

  const finals = {};
  for (const [label, fetchImpl] of Object.entries(paths)) {
    const h = createHarness({ fetchImpl });
    await h.submitForm();

    assert.ok(h.status._textLog.length > 0, `${label}: nothing was ever rendered`);
    for (const value of h.status._textLog) {
      assert.ok(
        typeof value === "string" && value.trim() !== "",
        `${label}: rendered an empty status, which .form__status:empty hides entirely`,
      );
    }
    assert.equal(h.submit.disabled, false, `${label}: the button never re-enabled`);
    finals[label] = h.status.textContent;
  }

  assert.equal(finals.success, "Thank you!");
  assert.equal(finals.httpError, "Name, email, and message are required.");

  // A not-ok response whose body is not JSON carries no server message, so form.js
  // must fall back to the copy that tells the visitor how to reach Ory instead.
  assert.equal(
    finals.jsonRejects,
    "Something went wrong — please email me directly instead.",
    "an unparseable error response must not surface the 'Request failed' sentinel",
  );

  // KNOWN DEFECT, reported separately rather than pinned here: a transport-level
  // rejection surfaces the browser's raw message ("Failed to fetch" / "Load failed")
  // instead of that same fallback, so the visitor loses the only recovery hint.
  // Asserted only as "non-empty and not the internal sentinel" so this case does not
  // enshrine the current wording.
  assert.notEqual(finals.networkRejection, "Request failed", "the internal sentinel must never be shown");
});

/* ================================================================== *
 * The markup half
 * ================================================================== */

test("every .js-form has exactly one .js-form-status and a real submit, and its page loads form.js", () => {
  const withForm = [];
  const withScript = [];

  for (const file of pageFiles()) {
    const html = pageHtml(file);
    const tokens = tokenize(html);

    const scripts = findElements(
      tokens,
      (t) => t.name === "script" && String(attr(t, "src") || "").includes("/assets/js/form.js"),
    );
    if (scripts.length > 0) withScript.push(file);

    const forms = formsIn(file);
    if (forms.length === 0) continue;
    withForm.push(file);

    for (const form of forms) {
      const statuses = [];
      for (let i = form.openIndex + 1; i < form.endIndex; i += 1) {
        const t = tokens[i];
        if (t.type === "open" && classTokens(t).includes("js-form-status")) statuses.push(t);
      }
      assert.equal(
        statuses.length,
        1,
        `${file}: form.js dereferences .js-form-status with no null guard, after preventDefault()`,
      );
      assert.equal(attr(statuses[0], "role"), "status", `${file}: the status paragraph must keep role="status"`);
      assert.equal(
        attr(statuses[0], "aria-live"),
        "polite",
        `${file}: the status paragraph must keep aria-live="polite"`,
      );

      const submits = form.controls.filter((c) => c.type === "submit");
      assert.ok(
        submits.length >= 1,
        `${file}: form.js dereferences [type="submit"] with no null guard, after preventDefault()`,
      );
      const plainButtons = form.controls.filter((c) => c.type === "button");
      assert.deepEqual(
        plainButtons.map((c) => c.line),
        [],
        `${file}: a type="button" control inside the form works only with JS and does nothing without it`,
      );
    }
  }

  assert.deepEqual(
    withForm,
    withScript,
    "a page has a .js-form iff it loads form.js — otherwise the form silently loses its enhancement, " +
      "or form.js runs with nothing to bind to",
  );

  const source = read("assets/js/form.js");
  for (const literal of [".js-form", ".js-form-status", '[type="submit"]']) {
    assert.ok(
      source.includes(literal),
      `form.js no longer looks for ${literal}, so the markup assertions above stopped meaning anything`,
    );
  }
});

test("the no-JS fallback and the honeypot stay intact across HTML, CSS and JS", () => {
  for (const file of formPages()) {
    const html = pageHtml(file);
    const tokens = tokenize(html);

    for (const form of formsIn(file)) {
      assert.equal(attr(form.token, "action"), "/api/contact", `${file}: the native POST target`);
      assert.equal(
        String(attr(form.token, "method") || "").toUpperCase(),
        "POST",
        `${file}: a GET form would put the message in the URL and never reach the handler`,
      );

      const gotcha = form.controls.find((c) => c.name === "_gotcha");
      assert.ok(gotcha, `${file}: the honeypot input is the only spam control on this endpoint`);
      assert.equal(gotcha.tag, "input");
      assert.equal(attr(gotcha.token, "tabindex"), "-1", `${file}: a sighted keyboard user must not tab into it`);
      assert.equal(attr(gotcha.token, "autocomplete"), "off", `${file}: autofill would trip the trap for real people`);
      assert.equal(
        gotcha.required,
        false,
        `${file}: a required off-screen input makes the browser refuse to submit natively ` +
          "(\"An invalid form control with name=_gotcha is not focusable\") — the fallback dies silently",
      );

      // The wrapper carries the class the CSS hides and the attribute that hides it
      // from assistive technology.
      let wrapper = null;
      for (let i = form.openIndex + 1; i < form.endIndex; i += 1) {
        const t = tokens[i];
        if (t.type === "open" && classTokens(t).includes("form__gotcha")) wrapper = t;
      }
      assert.ok(wrapper, `${file}: the honeypot must sit inside a .form__gotcha wrapper — that is what hides it`);
      assert.equal(attr(wrapper, "aria-hidden"), "true", `${file}: screen readers must not announce the trap`);
    }

    // The script tag must be a plain deferred external script, not wrapped in
    // <noscript> (which would invert the whole progressive-enhancement contract).
    let noscriptDepth = 0;
    let seen = 0;
    for (const t of tokens) {
      if (t.name === "noscript") {
        if (t.type === "open" && !t.selfClosing) noscriptDepth += 1;
        else if (t.type === "close") noscriptDepth = Math.max(0, noscriptDepth - 1);
        continue;
      }
      if (t.type !== "open" || t.name !== "script") continue;
      const src = String(attr(t, "src") || "");
      if (!src.includes("/assets/js/form.js")) continue;
      seen += 1;
      assert.equal(noscriptDepth, 0, `${file}: form.js inside <noscript> would only run when JS is off`);
      assert.ok(t.attrs.has("defer"), `${file}: form.js must stay deferred so the form exists when it binds`);
    }
    assert.equal(seen, 1, `${file}: expected exactly one form.js script tag`);
  }

  // The CSS third of the contract: without this rule the honeypot is a visible text
  // input labelled "Leave this field empty", real visitors fill it in, and the
  // handler 303s them to /thanks while discarding the message.
  const blocks = cssBlocks(read("assets/css/style.css"));
  const gotchaBlocks = blocks.filter((b) => b.selectors.includes(".form__gotcha"));
  assert.equal(gotchaBlocks.length, 1, "style.css must carry exactly one .form__gotcha rule");
  const block = gotchaBlocks[0];
  assert.equal(decl(block, "position"), "absolute", `style.css:${block.line}: the honeypot must be taken out of flow`);
  const left = Number.parseFloat(String(decl(block, "left")));
  assert.ok(
    Number.isFinite(left) && left <= -1000,
    `style.css:${block.line}: the honeypot must be moved far off-screen, got left: ${decl(block, "left")}`,
  );
});

test("compound-selector modifiers carry their base class in the HTML", () => {
  const blocks = cssBlocks(read("assets/css/style.css"));
  const pairs = new Map(); // modifier -> Set(bases)

  for (const block of blocks) {
    for (const selector of block.selectors) {
      const re = /\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)/g;
      let m;
      while ((m = re.exec(selector)) !== null) {
        const [, base, modifier] = m;
        if (base === modifier) continue;
        if (!pairs.has(modifier)) pairs.set(modifier, new Set());
        pairs.get(modifier).add(base);
      }
    }
  }

  assert.ok(pairs.size > 0, "no compound selectors found — the parser or the regex stopped working");

  for (const file of pageFiles()) {
    const html = pageHtml(file);
    for (const { token } of findElements(tokenize(html), () => true)) {
      const tokensOnEl = classTokens(token);
      if (tokensOnEl.length === 0) continue;
      for (const [modifier, bases] of pairs) {
        if (!tokensOnEl.includes(modifier)) continue;
        for (const base of bases) {
          assert.ok(
            tokensOnEl.includes(base),
            `${file}:${lineOf(html, token.index)}: class="${tokensOnEl.join(" ")}" uses .${modifier}, ` +
              `which style.css only ever styles as .${base}.${modifier} — without .${base} it has zero styling`,
          );
        }
      }
    }
  }
});
