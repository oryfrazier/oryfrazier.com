/* tests/helpers/form-harness.mjs — TEST-ONLY. Never shipped, never referenced by the site.
 *
 * Runs the REAL text of assets/js/form.js inside a node:vm context against a minimal
 * fake DOM, so the tests exercise the shipped file rather than a re-implementation.
 * Node stdlib only (node:vm) — zero npm dependencies, no build step.
 *
 * THIS FILE IS NOT A TEST FILE, and it is inert only because the directory is
 * `tests/` (plural): Node's default `node --test` glob matches `**\/*.test.mjs` and
 * `**\/test/**`, so `tests/helpers/*.mjs` is not picked up (verified on Node v25.9.0).
 * Rename this directory to the singular `test/` and Node will execute this file as a
 * test that asserts nothing and reports green.
 *
 * FOUR LOAD-BEARING DETAILS. Each one, gotten wrong, makes the suite falsely green:
 *
 * 1. FLUSHING. form.js's submit handler is NOT async and returns nothing — its
 *    .then/.catch/.finally chain resolves several ticks after the handler returns.
 *    `await flush()` (a setImmediate turn, NOT `await null`) before EVERY assertion
 *    about submit.disabled, the final textContent, or form.reset(). Without it the
 *    test reads pre-fetch state and passes vacuously.
 * 2. THE FormData STUB IMPLEMENTS Symbol.iterator, not merely entries(). The
 *    `new URLSearchParams(x)` constructor dispatches on the iterator to pick the
 *    sequence-of-pairs overload; an object without one silently takes the record
 *    overload and produces garbage that still stringifies plausibly.
 * 3. classList IS SEEDED FROM THE REAL `class` ATTRIBUTE scraped out of the shipped
 *    markup, not from a literal here — otherwise the hook-class assertion only proves
 *    form.js does not remove what the test itself inserted.
 * 4. THE NODE MODELS className AND setAttribute('class', …) as replacing the backing
 *    class set, so a regression that swaps classList.add for a className assignment
 *    is caught behaviourally rather than by a source regex.
 */

import vm from "node:vm";

import { attr, classTokens, findElements, matchingClose, read, tokenize } from "./repo.mjs";

/** Absolute-ish repo path of the script under test. */
export const FORM_JS = "assets/js/form.js";

/** Flush to completion: one setImmediate turn drains the whole microtask queue; two for margin. */
export async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/* ------------------------------------------------------------------ *
 * Scraping the real markup (details 3 and the seam tests' field names)
 * ------------------------------------------------------------------ */

function formTokenIndex(tokens) {
  const forms = findElements(tokens, (t) => t.name === "form" && classTokens(t).includes("js-form"));
  if (forms.length === 0) throw new Error("no .js-form found in markup");
  return forms[0].index;
}

/** The literal `class` attribute of the first .js-form-status element in a shipped page. */
export function statusClassAttrFrom(file = "contact.html") {
  const tokens = tokenize(read(file));
  const hits = findElements(tokens, (t) => classTokens(t).includes("js-form-status"));
  if (hits.length === 0) throw new Error(`no .js-form-status element in ${file}`);
  return attr(hits[0].token, "class");
}

/** The `action` attribute of the first .js-form in a shipped page. */
export function formActionFrom(file = "contact.html") {
  const tokens = tokenize(read(file));
  return attr(tokens[formTokenIndex(tokens)], "action");
}

/**
 * [name, value] pairs a real browser's FormData would build from the first .js-form
 * in a shipped page: every named input/textarea/select inside the form element,
 * with `sample` filling in the empty ones so the body is non-trivial.
 */
export function formFieldsFrom(file = "contact.html", sample = {}) {
  const html = read(file);
  const tokens = tokenize(html);
  const start = formTokenIndex(tokens);
  const close = matchingClose(tokens, start);
  const end = close === -1 ? tokens.length : close;

  const pairs = [];
  for (let i = start + 1; i < end; i += 1) {
    const t = tokens[i];
    if (t.type !== "open") continue;
    if (!["input", "textarea", "select"].includes(t.name)) continue;
    const name = attr(t, "name");
    if (!name) continue;
    const value = Object.hasOwn(sample, name) ? sample[name] : (attr(t, "value") ?? "");
    pairs.push([name, String(value)]);
  }
  return pairs;
}

/** Field names in the first .js-form of a page, in document order. */
export function formFieldNames(file = "contact.html") {
  return formFieldsFrom(file).map(([name]) => name);
}

/* ------------------------------------------------------------------ *
 * Fake DOM
 * ------------------------------------------------------------------ */

class FakeClassList {
  constructor(initial) {
    this._set = new Set(initial);
  }
  add(...names) {
    for (const n of names) if (n) this._set.add(n);
  }
  remove(...names) {
    for (const n of names) this._set.delete(n);
  }
  contains(name) {
    return this._set.has(name);
  }
  toggle(name, force) {
    const want = force === undefined ? !this._set.has(name) : Boolean(force);
    if (want) this._set.add(name);
    else this._set.delete(name);
    return want;
  }
  replace(oldName, newName) {
    if (!this._set.has(oldName)) return false;
    this._set.delete(oldName);
    this._set.add(newName);
    return true;
  }
  /** Wholesale replacement, used by `className =` and `setAttribute('class', …)`. */
  _reset(value) {
    this._set = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get length() {
    return this._set.size;
  }
  get value() {
    return [...this._set].join(" ");
  }
  toString() {
    return this.value;
  }
  [Symbol.iterator]() {
    return this._set[Symbol.iterator]();
  }
}

function makeNode({ classAttr = "", tagName = "p", attrs = {} } = {}) {
  const classList = new FakeClassList(String(classAttr).split(/\s+/).filter(Boolean));
  const bag = new Map(Object.entries(attrs));
  let text = "";

  const node = {
    tagName: tagName.toUpperCase(),
    classList,
    /** Every value ever assigned to textContent, in order. */
    _textLog: [],
    /** Snapshot of the class set at each textContent assignment. */
    _classLog: [],
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = String(value);
      node._textLog.push(text);
      node._classLog.push([...classList._set]);
    },
    get className() {
      return classList.value;
    },
    set className(value) {
      classList._reset(value);
    },
    getAttribute(name) {
      if (name.toLowerCase() === "class") return classList.value;
      return bag.has(name) ? bag.get(name) : null;
    },
    setAttribute(name, value) {
      if (name.toLowerCase() === "class") classList._reset(value);
      else bag.set(name, String(value));
    },
    removeAttribute(name) {
      if (name.toLowerCase() === "class") classList._reset("");
      else bag.delete(name);
    },
    hasAttribute(name) {
      return name.toLowerCase() === "class" ? classList.length > 0 : bag.has(name);
    },
  };
  return node;
}

/** A response object shaped like the bits of Response that form.js touches. */
export function makeResponse({ ok = true, status = 200, body = {}, jsonRejects = false } = {}) {
  return {
    ok,
    status,
    json() {
      return jsonRejects
        ? Promise.reject(new SyntaxError("Unexpected token < in JSON at position 0"))
        : Promise.resolve(body);
    },
  };
}

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

/**
 * Run the real assets/js/form.js against a fake DOM.
 *
 * Options:
 *   statusClassAttr — defaults to the REAL class attribute scraped from `page`.
 *   formAction      — defaults to the REAL action attribute scraped from `page`.
 *   fields          — [name, value] pairs the FormData stub yields; defaults to the
 *                     real field names scraped from `page`, filled from `sample`.
 *   fetchImpl       — (url, init) => response-or-promise. Default: 200 with {}.
 *
 * Returns { form, status, submit, fetch: { calls }, submitHandler, submitForm, flush, ... }.
 */
export function createHarness({
  page = "contact.html",
  statusClassAttr = null,
  formAction = null,
  fields = null,
  sample = { name: "Ada Lovelace", email: "ada@example.com", message: "Hello\n\nthere", pronouns: "she/her" },
  fetchImpl = null,
} = {}) {
  const statusClass = statusClassAttr === null ? statusClassAttrFrom(page) : statusClassAttr;
  const action = formAction === null ? formActionFrom(page) : formAction;
  const pairs = fields === null ? formFieldsFrom(page, sample) : fields.map((p) => [...p]);

  const status = makeNode({ classAttr: statusClass, tagName: "p" });
  const submit = makeNode({ classAttr: "button", tagName: "button", attrs: { type: "submit" } });
  /** Every value ever assigned to submit.disabled, in order. */
  submit._disabledLog = [];
  let disabledBacking = false;
  Object.defineProperty(submit, "disabled", {
    get() {
      return disabledBacking;
    },
    set(value) {
      disabledBacking = Boolean(value);
      submit._disabledLog.push(disabledBacking);
    },
    enumerable: true,
    configurable: true,
  });

  const listeners = [];
  const form = {
    action,
    method: "POST",
    tagName: "FORM",
    classList: new FakeClassList(["form", "js-form"]),
    _fields: pairs,
    resetCalls: 0,
    /** Order of interest: was reset() called before or after the status update? */
    _log: [],
    reset() {
      form.resetCalls += 1;
      form._log.push("reset");
    },
    querySelector(selector) {
      if (selector === ".js-form-status") return status;
      if (selector === '[type="submit"]') return submit;
      return null;
    },
    addEventListener(type, handler) {
      listeners.push({ type, handler });
    },
  };

  const document = {
    querySelectorAll(selector) {
      return selector === ".js-form" ? [form] : [];
    },
    querySelector(selector) {
      return selector === ".js-form" ? form : null;
    },
  };

  class FormDataStub {
    constructor(sourceForm) {
      FormDataStub.constructedWith.push(sourceForm);
      const src = sourceForm && Array.isArray(sourceForm._fields) ? sourceForm._fields : [];
      this._pairs = src.map(([k, v]) => [String(k), String(v)]);
    }
    // DETAIL 2: URLSearchParams dispatches on Symbol.iterator to select the
    // sequence-of-pairs overload. entries() alone is not enough.
    *[Symbol.iterator]() {
      yield* this._pairs.map((p) => [...p]);
    }
    *entries() {
      yield* this._pairs.map((p) => [...p]);
    }
    *keys() {
      for (const [k] of this._pairs) yield k;
    }
    *values() {
      for (const [, v] of this._pairs) yield v;
    }
    get(name) {
      const hit = this._pairs.find(([k]) => k === name);
      return hit ? hit[1] : null;
    }
    getAll(name) {
      return this._pairs.filter(([k]) => k === name).map(([, v]) => v);
    }
    has(name) {
      return this._pairs.some(([k]) => k === name);
    }
    append(name, value) {
      this._pairs.push([String(name), String(value)]);
    }
    set(name, value) {
      this._pairs = this._pairs.filter(([k]) => k !== name);
      this._pairs.push([String(name), String(value)]);
    }
  }
  FormDataStub.constructedWith = [];

  const defaultFetch = () => makeResponse({ ok: true, status: 200, body: {} });
  const impl = fetchImpl || defaultFetch;
  const fetchSpy = (url, init) => {
    fetchSpy.calls.push({ url, init });
    return Promise.resolve().then(() => impl(url, init));
  };
  fetchSpy.calls = [];

  // The REAL global URLSearchParams goes into the context, so instances created
  // inside the vm are host URLSearchParams and `instanceof` holds in the test.
  const context = vm.createContext({
    document,
    fetch: fetchSpy,
    FormData: FormDataStub,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
  });

  const source = read(FORM_JS);
  new vm.Script(source, { filename: FORM_JS }).runInContext(context);

  const submitListeners = listeners.filter((l) => l.type === "submit");
  if (submitListeners.length !== 1) {
    throw new Error(`expected exactly one submit listener, got ${submitListeners.length}`);
  }
  const submitHandler = submitListeners[0].handler;

  function makeEvent() {
    return {
      type: "submit",
      defaultPrevented: false,
      preventDefaultCalls: 0,
      preventDefault() {
        this.defaultPrevented = true;
        this.preventDefaultCalls += 1;
      },
    };
  }

  /**
   * Dispatch a submit and flush the (non-async) handler's promise chain to completion.
   * Returns the event so the test can assert preventDefault() ran.
   */
  async function submitForm() {
    const event = makeEvent();
    submitHandler(event);
    await flush();
    return event;
  }

  return {
    context,
    document,
    form,
    status,
    submit,
    listeners,
    submitHandler,
    makeEvent,
    submitForm,
    flush,
    fetch: fetchSpy,
    FormData: FormDataStub,
    fields: pairs,
    statusClassAttr: statusClass,
    formAction: action,
  };
}

if (import.meta.main) {
  const h = createHarness();
  const event = h.makeEvent();
  h.submitHandler(event);
  await flush();
  process.stdout.write(
    [
      `statusClassAttr  ${JSON.stringify(h.statusClassAttr)}`,
      `formAction       ${h.formAction}`,
      `fields           ${JSON.stringify(h.fields.map(([k]) => k))}`,
      `fetch calls      ${h.fetch.calls.length} -> ${h.fetch.calls[0]?.url}`,
      `body ctor        ${h.fetch.calls[0]?.init.body?.constructor?.name}`,
      `textLog          ${JSON.stringify(h.status._textLog)}`,
      `classes          ${JSON.stringify(h.status.classList.value)}`,
      `submit.disabled  ${h.submit.disabled} (log ${JSON.stringify(h.submit._disabledLog)})`,
      `form.reset()     ${h.form.resetCalls}`,
      "",
    ].join("\n"),
  );
}
