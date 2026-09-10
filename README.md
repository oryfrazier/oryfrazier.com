# oryfrazier.com

A hand-coded static rebuild of the Squarespace site at
[oryfrazier.com](https://www.oryfrazier.com) — no build step, no framework, no npm
dependencies. Deployed on Vercel, DNS and email forwarding at
Porkbun.

Open items live in [TODO.md](TODO.md).

```
.
├── index.html            Home  (hero, stats, offer, contact form)
├── coaching.html         Coaching — the two tracks and how it works
├── about.html            About  (bio, credential, race record)
├── projects.html         Projects — Medaling with Friends, IceCycles
├── contact.html          Contact (form + photo)
├── thanks.html           Form success page (no-JS fallback lands here)
├── 404.html
├── api/contact.mjs        Serverless function → Resend
├── favicon.svg
├── robots.txt / sitemap.xml
├── vercel.json           Clean URLs, cache headers, redirects
└── assets/
    ├── css/style.css     All styles. Design tokens live at the top.
    ├── js/form.js        Progressive-enhancement form submit
    ├── fonts/            Self-hosted Fredoka + Nunito (SIL OFL)
    └── img/              Photos at 750 / 1500 / 2500px (WebP)
```

## Local preview

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

That serves the static pages but **not** `api/contact.mjs`. To exercise the
contact form locally you need `vercel dev` (which does require the Vercel CLI
and an npm install — the only thing in this repo that does).

Note that `python3 -m http.server` doesn't do clean URLs, so links to `/about`
404 locally. They work in production because `vercel.json` sets
`cleanUrls: true`. Browse `/about.html` directly when previewing this way.

## Deploying

Vercel, on the personal `oryfrazier` account — the same one running Medaling
with Friends. Import the repo from the Vercel dashboard:

- **Framework preset:** Other
- **Build command:** none
- **Output directory:** leave as the repo root

Everything else comes from `vercel.json`. Pushes to `main` auto-deploy.

### Plan

This site is commercial (it sells coaching), and Vercel's Hobby plan is
restricted to non-commercial personal use. It needs to be on a **Pro** team —
$20/month for one developer seat, which covers every project on the account,
MWF included.

### Domain

Set **www.oryfrazier.com as the primary domain** and let the apex redirect to
it. That matches what Squarespace serves today, so existing search rankings and
inbound links land on the canonical URL rather than through a redirect. All the
`<link rel="canonical">` tags and `sitemap.xml` already point at www.

DNS is at Porkbun (same registrar as Medaling with Friends). The zone holds
the Vercel `A` + `www` CNAME, the three Resend records, and Porkbun's own
forwarding records for `howdy@` and `ory@`.

## The contact form

Both forms POST to `api/contact.mjs`, which relays the message through
[Resend](https://resend.com) — the same service MWF uses for transactional
mail. No third party stores your enquiries, and there's no monthly submission
cap to worry about.

### Setup

1. **Verify `oryfrazier.com` in Resend** (Domains → Add Domain, then add the
   DNS records it gives you). MWF's verified domain is
   `medalingwithfriends.com`; sending coaching enquiries from that domain would
   look wrong, so this site needs its own.

2. **Add three environment variables** in Vercel → Settings → Environment
   Variables:

   | Variable | Example |
   | --- | --- |
   | `RESEND_API_KEY` | `re_...` |
   | `EMAIL_FROM` | `Ory Frazier <howdy@oryfrazier.com>` |
   | `CONTACT_TO` | `oryfrazier@gmail.com` |

3. **Redeploy.** Until all three are set the function returns a 500 and logs
   "Contact form is missing Resend configuration."

Replies go to the sender's address (`reply_to` is set), so you can answer
straight from your inbox.

### How it behaves

- With JS: submits in the background, shows "Thank you!" inline — same as the
  Squarespace original.
- Without JS: a normal POST, then a 303 redirect to `/thanks`.
- A hidden honeypot field (`_gotcha`) silently swallows naive bot submissions.
- Fields are length-capped and the email is format-checked server-side.

## Notes on fidelity

Reproduced from the live Squarespace DOM, CSS variables, and section metadata.
Content, layout proportions, colours, and image assets are the originals.

**Fonts are the one deliberate substitution.** The original uses Omnes Pro, an
Adobe Fonts family licensed through Squarespace — it can't legally be
self-hosted without an Adobe plan. This build uses **Fredoka** (headings) and
**Nunito** (body), both open-licensed and visually close. To go back to the real
thing: add your Adobe Fonts kit `<link>` to each page's `<head>` and set
`--font-heading` / `--font-body` in `assets/css/style.css` to `"omnes-pro"`.

Colours, taken from the Squarespace palette:

| Token | Value | Used for |
| --- | --- | --- |
| `--bg` | `#f4f4f3` | page background |
| `--ink` | `#4f4f4f` | headings |
| `--text` | `#000` | body copy |
| `--accent` | `#7877e6` | buttons, links, focus rings |

Layout differences worth knowing about: Squarespace's "fluid engine" positions
every block on a 24-column × N-row grid with absolute row spans. This rebuild
keeps the same column proportions but lets rows size to their content, so text
edits reflow sensibly instead of overlapping. Sections stack to one column below
768px, with images last — same as the original.

## Editing

Everything is plain HTML. The header and footer are duplicated across the seven
pages; that's now the main argument for a static site generator (Eleventy or
Astro) — seven copies of a nav is about where hand-maintenance starts to cost
more than the toolchain would.

## Positioning

The site leads on **mindset coaching for endurance athletes**, with leadership
and career coaching as a second track. That's a deliberate narrowing from the
original generic "leadership and life coaching", which competed against every
other Co-Active coach on identical ground.

The differentiators, in order: a verifiable ultrarunning record (five 100-mile
finishes including Leadville), the Co-Active credential, and being an openly
queer and non-binary coach in a sport that is overwhelmingly neither. The
projects are framed as evidence of the community thread, not as portfolio.

## Tests

```sh
node --test
```

83 tests, no dependencies, about three seconds. The suite uses only `node:test`
and `node:assert` — installing anything would break the constraint the repo is
built around, and `tests/repo-constraints.test.mjs` fails if a `package.json`
with dependencies or a `node_modules` ever appears.

What it covers, and why each part exists:

| File | Guards |
| --- | --- |
| `contact-handler.test.mjs` | Every branch of `api/contact.mjs` — body shapes Vercel can deliver, honeypot, validation, content negotiation, HTML escaping, Resend payload shape |
| `form-contract.test.mjs` | `assets/js/form.js` run for real in a `node:vm` sandbox, plus **seam tests** proving the bytes the form sends are the bytes the handler parses |
| `pages.test.mjs` | Link and asset integrity, tag balance, nav/footer consistency, headings, labels, alt text, the skip link |
| `deploy-config.test.mjs` | `vercel.json`, canonical/og agreement, sitemap vs robots, redirect shadowing |
| `repo-constraints.test.mjs` | Zero-dependency rule, cache-bust token **currency** (via git), doc accuracy |
| `styles.test.mjs` | Modifier specificity ordering, `font-kerning` coverage, `var()` definitions, brace balance |

Every test in here exists because something actually broke during the build.
The suite was mutation-tested: each of the six bugs that shipped was
re-introduced, and each one turns the suite red.

### When it runs

| Trigger | Where results live |
| --- | --- |
| `node --test` | Your terminal |
| `git push` | Blocked locally by `.githooks/pre-push` if anything is red |
| Push to `main`, or any PR | GitHub Actions tab, ~10s |

**Enable the hook once per clone:**

```sh
git config core.hooksPath .githooks
```

That matters because **Vercel deploys straight from the push and does not wait
for CI**. GitHub Actions tells you a commit is broken a few seconds after the
broken version is already live. The pre-push hook is the last point where
stopping is still cheap. `git push --no-verify` bypasses it when you need to.

CI config is `.github/workflows/test.yml`. Note the `fetch-depth: 0` — the
cache-bust currency check queries git history and skips on a shallow clone.

## Changing CSS or JS

There's no build step, so filenames aren't fingerprinted. Browsers can hold a
stale stylesheet after a change.

**When you edit `style.css` or `form.js`, bump the version query in every
page's `<head>`:**

```sh
# 2 -> 3, across all pages
sed -i '' 's|style\.css?v=2|style.css?v=3|; s|form\.js?v=2|form.js?v=3|' *.html
```

That changes the URL, so browsers fetch the new file immediately instead of
waiting out their cached copy. `vercel.json` also sets `max-age=0,
must-revalidate` on these files, which handles it going forward — the version
query is the belt to that suspenders, and the only thing that helps visitors
who cached a copy under an older policy.
