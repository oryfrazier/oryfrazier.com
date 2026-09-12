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
├── links.html            Link hub — the one URL for a bio link or QR code
├── thanks.html           Form success page (no-JS fallback lands here)
├── 404.html
├── api/contact.mjs        Serverless function → Resend
├── api/go.mjs             Serverless function → outbound click counter (/go/<slug>)
├── favicon.svg
├── robots.txt / sitemap.xml
├── vercel.json           Clean URLs, cache headers, redirects
└── assets/
    ├── css/style.css     All styles. Design tokens live at the top.
    ├── js/form.js        Progressive-enhancement form submit
    ├── js/links.js       Outbound clicks as Analytics events (/links only)
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

## The /links page

`/links` replaced a Linktree at `linktr.ee/oryfrazier`, on 2026-09-10. The
Linktree had taken **82 views in 365 days** and carried two links — the site
and Instagram — while the coaching offer, the podcast and both projects were
not on it at all.

At that volume the hosted hub was not earning what it cost:

- **an extra hop** between a bio-link tap and anything worth reading;
- **no measurement** that reached this repo, so the only numbers about Ory's
  own audience lived in someone else's dashboard;
- **a competing search result** for Ory's own name, on a domain we do not own;
- **someone else's advertising** on the page — a "get your own Linktree"
  footer and an Explore drawer promoting unrelated brands to Ory's visitors;
- **no room to explain a link.** Linktree's free tier gives a title and
  nothing else, and "IceCycles" alone tells a runner nothing.

So the same idea now lives here: one page, one column of tap targets, a
subtitle on every one, in the site's own type and colour, measured by the
mechanisms described below.

**`/links` is deliberately not in the nav.** It is the destination for a bio
link, a QR code or a talk slide, and duplicates paths the nav already covers.
It is indexed on its own and listed in `sitemap.xml`, but a visitor who
arrives at the front door should never be routed through it.

The Linktree itself was cut down to a single button pointing here rather than
deleted, because old QR codes and forgotten bio links still resolve to it.
Delete it once those have aged out.

## Measurement

Two independent things, because they answer different questions and fail in
different ways.

**Page views — Vercel Web Analytics.** Two lines before `</body>` on every page:
a queue stub, then `<script defer src="/_vercel/insights/script.js">`. The
script is served from this origin, so the site still makes no third-party
request. The stub has to come first — a `va(...)` call before the real script
loads throws without it — and `deploy-config.test.mjs` asserts both the exact
snippet and that ordering on every page.

**It must be switched on in the Vercel dashboard** (Project → Analytics →
Enable Web Analytics). Until it is, the script 404s and nothing is recorded.
Custom events need the Pro plan, which this project is already on.

**Outbound clicks — `/go/<slug>`.** Every off-site link on `/links` points at
`/go/<slug>`; `vercel.json` rewrites that onto `api/go.mjs`, which logs one JSON
line and 302s to the destination. Adding an outbound link means adding a slug to
`DESTINATIONS` in that file first — a page that links at an undefined slug fails
`deploy-config.test.mjs` rather than silently redirecting people to the fallback.

**A slug is a public URL, not an internal name.** Instagram's bio links point
straight at `/go/medaling-with-friends` and `/go/ice-cycles` rather than at the
two sites, so that traffic is counted too. Renaming a slug therefore breaks a
link that is live on another platform and cannot be fixed from this repo.
Unknown slugs land on `/links` instead of a 404, which softens that failure but
does not undo it — add a new slug, keep the old one.

Why both: the redirect is the authoritative count and works with JavaScript
disabled, but it is only readable through `vercel logs` or a drain.
`assets/js/links.js` sends the same click to Web Analytics as an `outbound`
event so it can be read on a dashboard. The two can disagree — the difference
is roughly the JavaScript-blocked traffic, which is worth knowing on its own.

Two decisions in `api/go.mjs` that look like details and are not:

- **302, never 301.** A permanent redirect is cached by the browser for as long
  as it likes, so the second click never reaches the function. The count
  flatlines and the destination becomes unchangeable for anyone who has clicked
  before.
- **`Cache-Control: no-store`.** Same failure through the CDN instead of the
  browser.

The click log records the slug, the destination, the referer and a timestamp.
No IP address and no user agent — the question is which link gets clicked, and
there is no reason for this site to hold more than that. A test asserts their
absence, so adding one "just for debugging" turns the suite red.

## Being found by AI search

Two things matter and both are cheap.

**`robots.txt` names the AI crawlers explicitly.** The wildcard already allowed
them, but the file now separates the two kinds so the distinction is visible and
easy to change:

- **Search / citation** — `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`,
  `Claude-User`, `PerplexityBot`. Allowing these is what makes the site eligible
  to be cited in an AI answer.
- **Training** — `GPTBot`, `ClaudeBot`, `Google-Extended`. Separate agents.
  Blocking them would not affect citation eligibility.

Both are allowed. Blocking training is a one-line change per group if that view
ever shifts.

**Every indexable page carries JSON-LD**, sharing one `Person` node at
`https://www.oryfrazier.com/#person` so the graph joins up across pages:

| Page | Types |
| --- | --- |
| `/` | WebSite, Person |
| `/about` | Person with `hasCredential` (the CAP) |
| `/coaching` | Service with an Offer carrying the real price |
| `/projects` | PodcastSeries (Hard Days), Person |
| `/links` | ProfilePage, Person |
| `/contact` | ContactPage, Person |

`404` and `thanks` are `noindex` and deliberately carry none.

A test asserts the markup parses, that the `Person` `@id` is identical
everywhere, and that **any price in the markup also appears on the page** —
structured data that contradicts the visible copy is an SEO penalty and, more
importantly, untrue.

One honest caveat: the structured-data industry claims JSON-LD is mandatory for
AI search. Google states no special markup is required for its AI features. The
defensible version is narrower — it makes entity extraction unambiguous rather
than inferred, it costs nothing, and it cannot hurt. It is not what makes a site
get cited; links and traffic are.

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

Everything is plain HTML. The header and footer are duplicated across every
page; that's now the main argument for a static site generator (Eleventy or
Astro) — this many copies of a nav is about where hand-maintenance starts to
cost more than the toolchain would.

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

93 tests, no dependencies, about three seconds. The suite uses only `node:test`
and `node:assert` — installing anything would break the constraint the repo is
built around, and `tests/repo-constraints.test.mjs` fails if a `package.json`
with dependencies or a `node_modules` ever appears.

What it covers, and why each part exists:

| File | Guards |
| --- | --- |
| `go-handler.test.mjs` | Every branch of `api/go.mjs` — known and unknown slugs, the 302-not-301 rule, `no-store`, slug parsing, and what the click log may contain |
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
