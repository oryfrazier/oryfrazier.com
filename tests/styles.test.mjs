/* tests/styles.test.mjs — structural invariants of assets/css/style.css.
 *
 * There is no build step and no linter in this repo, so nothing but a browser
 * ever reads this stylesheet, and a browser reports none of these failures: it
 * silently drops an invalid declaration, silently swallows every rule after an
 * unclosed comment, and silently lets a later rule at equal specificity beat an
 * earlier one. Every case below is a failure mode that ships green.
 *
 * Pure string and source-order analysis — nothing is rendered. Node stdlib only.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  classTokens,
  cssBlocks,
  declarations,
  findElements,
  lineOf,
  pages,
  read,
  tokenize,
} from "./helpers/repo.mjs";

const CSS_FILE = "assets/css/style.css";
const css = read(CSS_FILE);
const blocks = cssBlocks(css);

/** The at-rule context of a block, as a comparable key ("" at top level). */
function context(block) {
  return block.atRules.join(" && ");
}

/** Property names declared in a block, in source order. */
function props(block) {
  return declarations(block).map(([name]) => name);
}

/**
 * Do two property names fight? Same name, or one is a longhand of the other
 * (`padding` vs `padding-top`, `background` vs `background-color`). The prefix
 * rule over-matches slightly (`border` vs `border-radius`), which only ever
 * makes the modifier-ordering check stricter — never falsely lenient.
 */
function propsConflict(a, b) {
  return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

test("style.css exists and parses into leaf declaration blocks", () => {
  assert.ok(css.length > 1000, "stylesheet is suspiciously small");
  assert.ok(blocks.length > 50, `expected many CSS blocks, parsed ${blocks.length}`);
});

/* ------------------------------------------------------------------ *
 * 1. Modifier ordering
 * ------------------------------------------------------------------ */

test("single-class modifiers are declared after their base, or use the compound form", () => {
  // A selector that is exactly one modifier class: `.button--disabled`, not
  // `.button.button--disabled` (which wins on specificity, 0,2,0) and not
  // `.split--image-left .split__media` (which targets a different element).
  const MODIFIER = /^\.([a-z0-9-]+)--[a-z0-9-]+$/;

  const failures = [];
  for (const block of blocks) {
    const ctx = context(block);
    const blockProps = props(block);
    for (const selector of block.selectors) {
      const match = MODIFIER.exec(selector);
      if (!match) continue;
      const base = `.${match[1]}`;

      for (const other of blocks) {
        // Only a LATER block can win at equal specificity.
        if (other.sourceIndex <= block.sourceIndex) continue;
        // Only within the same at-rule context. A base re-declared inside
        // `@media (max-width: 767px)` deliberately overrides the modifiers
        // declared above it — that is how every .split-- variant collapses to
        // one column on mobile, and it is correct, not a bug.
        if (context(other) !== ctx) continue;
        // EXACTLY the bare base class: no pseudo-class, no compounding, no
        // descendant. `.form__status:empty` is specificity (0,2,0) and does not
        // beat `.form__status--error`; treating it as a base would false-fail.
        if (!other.selectors.includes(base)) continue;

        const clashing = props(other).filter((p) => blockProps.some((q) => propsConflict(p, q)));
        if (clashing.length === 0) continue;

        failures.push(
          `${selector} (line ${block.line}) is overridden by the later base ${base} ` +
            `(line ${other.line}) at equal specificity; clashing: ${clashing.join(", ")}. ` +
            `Fix by compounding: ${base}${selector}`,
        );
      }
    }
  }

  assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
});

/* ------------------------------------------------------------------ *
 * 2. Heading font ⊆ kerning-off list
 * ------------------------------------------------------------------ */

const HEADING_FONT = /var\(\s*--font-heading\s*\)/;

function headingSelectors() {
  const set = new Set();
  for (const block of blocks) {
    const usesHeading = declarations(block).some(
      ([name, value]) => name === "font-family" && HEADING_FONT.test(value),
    );
    if (usesHeading) for (const selector of block.selectors) set.add(selector);
  }
  return set;
}

function kerningOffBlocks() {
  return blocks.filter((block) =>
    declarations(block).some(([name, value]) => name === "font-kerning" && value.trim() === "none"),
  );
}

test("the font-kerning:none list lives in exactly one block", () => {
  const found = kerningOffBlocks();
  assert.equal(
    found.length,
    1,
    `expected one font-kerning:none rule so the list stays reviewable in one place; ` +
      `found ${found.length} at lines ${found.map((b) => b.line).join(", ")}`,
  );
});

test("every selector that declares the heading font is in the font-kerning:none list", () => {
  const heading = headingSelectors();
  const kerned = new Set(kerningOffBlocks().flatMap((block) => block.selectors));

  assert.ok(heading.size > 0, "no selector declares font-family: var(--font-heading)");

  // Subset, not equality: adding a selector to the kern rule without giving it
  // its own font-family declaration is legitimate (font-kerning inherits), and
  // a test that fails on correct code is a test that gets deleted.
  const missing = [...heading].filter((selector) => !kerned.has(selector)).sort();
  assert.deepEqual(
    missing,
    [],
    `these use Fredoka but keep its kerning, so all-caps glyphs collide: ${missing.join(", ")}`,
  );
});

/* ------------------------------------------------------------------ *
 * 3. Custom properties
 * ------------------------------------------------------------------ */

test("every var(--x) used is defined in the file", () => {
  const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]));
  const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

  assert.ok(used.size > 5, `expected the stylesheet to use custom properties, found ${used.size}`);

  const undefined_ = [...used].filter((name) => !defined.has(name)).sort();
  assert.deepEqual(
    undefined_,
    [],
    `undefined custom properties make the whole declaration invalid at computed-value ` +
      `time, so the property silently falls back to inherit/initial: ${undefined_.join(", ")}`,
  );
});

/* ------------------------------------------------------------------ *
 * 4. Delimiter balance
 * ------------------------------------------------------------------ */

test("braces and comment delimiters balance, with no nested /*", () => {
  let depth = 0;
  let opens = 0;
  let closes = 0;
  let commentOpens = 0;
  let commentCloses = 0;
  let commentStart = -1;
  let inComment = false;
  let quote = null;
  const problems = [];

  for (let i = 0; i < css.length; i += 1) {
    const two = css.slice(i, i + 2);

    if (inComment) {
      if (two === "/*") {
        problems.push(`nested /* at line ${lineOf(css, i)} (comment opened at line ${lineOf(css, commentStart)})`);
        commentOpens += 1;
        i += 1;
      } else if (two === "*/") {
        commentCloses += 1;
        inComment = false;
        i += 1;
      }
      continue;
    }

    const ch = css[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (two === "/*") {
      inComment = true;
      commentStart = i;
      commentOpens += 1;
      i += 1;
      continue;
    }
    if (two === "*/") {
      commentCloses += 1;
      problems.push(`stray */ at line ${lineOf(css, i)}`);
      i += 1;
      continue;
    }
    if (ch === "{") {
      opens += 1;
      depth += 1;
    } else if (ch === "}") {
      closes += 1;
      depth -= 1;
      if (depth < 0) problems.push(`unmatched } at line ${lineOf(css, i)}`);
    }
  }

  if (inComment) {
    problems.push(
      `unterminated comment opened at line ${lineOf(css, commentStart)} — every rule below it is swallowed`,
    );
  }
  if (quote) problems.push("unterminated string literal");

  assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`);
  assert.equal(opens, closes, `brace imbalance: ${opens} '{' vs ${closes} '}'`);
  assert.equal(commentOpens, commentCloses, `comment imbalance: ${commentOpens} '/*' vs ${commentCloses} '*/'`);
  assert.equal(depth, 0, `stylesheet ends inside ${depth} unclosed block(s)`);
});

/* ------------------------------------------------------------------ *
 * 5. .hero depends on .section for its containing block
 * ------------------------------------------------------------------ */

test(".hero__bg containment: .section is position:relative", () => {
  const sectionBlocks = blocks.filter(
    (block) => context(block) === "" && block.selectors.includes(".section"),
  );
  assert.ok(sectionBlocks.length > 0, "no top-level `.section` rule found");

  // Last declaration wins in the cascade.
  let position = null;
  for (const block of sectionBlocks) {
    for (const [name, value] of declarations(block)) {
      if (name === "position") position = value.trim();
    }
  }

  assert.equal(
    position,
    "relative",
    ".hero declares no position of its own, so .hero__bg{position:absolute;inset:0} is " +
      "contained only by .section{position:relative}. Drop it and the hero photo fills " +
      "the entire document behind every section.",
  );
});

test("every element with class 'hero' also carries class 'section'", () => {
  const failures = [];
  let heroCount = 0;

  for (const { file, html } of pages()) {
    const tokens = tokenize(html);
    for (const { token } of findElements(tokens, (t) => classTokens(t).includes("hero"))) {
      heroCount += 1;
      const classes = classTokens(token);
      if (!classes.includes("section")) {
        failures.push(`${file}:${lineOf(html, token.index)} <${token.name} class="${classes.join(" ")}">`);
      }
    }
  }

  assert.ok(heroCount > 0, "no element with class 'hero' found on any page");
  assert.deepEqual(
    failures,
    [],
    `'hero' without 'section' loses position:relative, so the hero background escapes ` +
      `its containing block and covers the whole page:\n${failures.join("\n")}`,
  );
});

/* ------------------------------------------------------------------ *
 * 6. Body-copy links keep their underline
 * ------------------------------------------------------------------ */

test("no bare `a { text-decoration: none }`", () => {
  const BARE_ANCHOR = /^a(:link|:visited)?$/;

  const failures = [];
  for (const block of blocks) {
    const bare = block.selectors.filter((selector) => BARE_ANCHOR.test(selector));
    if (bare.length === 0) continue;
    const stripped = declarations(block).some(
      ([name, value]) => name === "text-decoration" && /\bnone\b/.test(value),
    );
    if (stripped) failures.push(`${block.prelude} at line ${block.line}`);
  }

  assert.deepEqual(
    failures,
    [],
    `nothing in this stylesheet gives body-copy links a colour — the user-agent ` +
      `underline is their only distinguishing cue, so removing it globally is a ` +
      `WCAG 1.4.1 failure that looks fine in a screenshot:\n${failures.join("\n")}`,
  );
});
