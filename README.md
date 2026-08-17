# oryfrazier.com

A hand-coded static rebuild of the Squarespace site at
[oryfrazier.com](https://oryfrazier.com) — three pages, no build step, no
framework, no dependencies. Open `index.html` in a browser and it works.

```
.
├── index.html            Home  (hero, journey, contact form)
├── about.html            About
├── contact.html          Contact (form + photo)
├── 404.html
├── favicon.svg
├── robots.txt / sitemap.xml
├── assets/
│   ├── css/style.css     All styles. Design tokens live at the top.
│   ├── js/form.js        Progressive-enhancement form submit (optional)
│   ├── fonts/            Self-hosted Fredoka + Nunito (SIL OFL)
│   └── img/              Photos at 750 / 1500 / 2500px (WebP)
├── _headers / _redirects Netlify + Cloudflare Pages config
├── netlify.toml
└── .github/workflows/deploy-pages.yml   GitHub Pages deploy
```

## Local preview

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening the files directly (`file://`) mostly works too, but the absolute
paths (`/assets/...`) need a server, so use the command above.

## Before you go live — two things

### 1. Wire up the contact form

Static hosting can't process form submissions, so the two forms post to
[Formspree](https://formspree.io) (free tier: 50 submissions/month).

1. Create a Formspree account and a new form.
2. Copy the form ID from the endpoint it gives you
   (`https://formspree.io/f/**xyzabcd**`).
3. Replace `YOUR_FORM_ID` in **`index.html`** and **`contact.html`**:

   ```sh
   grep -rl YOUR_FORM_ID . | xargs sed -i '' 's/YOUR_FORM_ID/xyzabcd/g'
   ```

Until that's done the forms fall back to a plain browser POST and will fail —
so do this before launch. `assets/js/form.js` then submits in the background
and shows "Thank you!" inline, matching the original site's behaviour.

Alternatives, if you'd rather not use Formspree: Netlify Forms (add
`data-netlify="true"` to each `<form>`, then delete the `action`), Basin, or
Web3Forms.

### 2. Point the domain

DNS still points at Squarespace. Once the site is deployed somewhere, update
the A/CNAME records at your registrar, then cancel the Squarespace plan —
**in that order**, and only after you've confirmed the new site is live.

## Deploying

The repo is host-agnostic; configs for all three common options are included.

**Cloudflare Pages** — connect the repo, framework preset "None", build
command empty, output directory `/`. `_headers` and `_redirects` are picked up
automatically.

**Netlify** — connect the repo. `netlify.toml` handles the rest.

**GitHub Pages** — Settings → Pages → Source: "GitHub Actions". The workflow in
`.github/workflows/deploy-pages.yml` deploys on every push to `main`. Note that
Pages can't do the `/about` → `/about.html` rewrites, so those clean URLs will
404 there; use Cloudflare or Netlify if you care about matching the old URLs.

## Notes on fidelity

Reproduced from the live Squarespace DOM, CSS variables, and section metadata.
Content, layout proportions, colours, and image assets are the originals.

**Fonts are the one deliberate substitution.** The original uses Omnes Pro,
an Adobe Fonts family licensed through Squarespace — it can't legally be
self-hosted without an Adobe plan. This build uses **Fredoka** (headings) and
**Nunito** (body), both open-licensed and visually close. To go back to the
real thing: add your Adobe Fonts kit `<link>` to each page's `<head>` and set
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
edits reflow sensibly instead of overlapping. Sections stack to one column
below 768px, with images last — same as the original.

## Editing

Everything is plain HTML. The header and footer are duplicated across the four
pages; if that starts to hurt, the natural next step is a tiny static site
generator (Eleventy or Astro), but for three pages the duplication is cheaper
than the toolchain.
