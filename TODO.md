# Loose ends

Migration off Squarespace finished 2026-09-04. The site is live at
https://www.oryfrazier.com, on Vercel, with DNS and email forwarding at
Porkbun. Nothing below is blocking — it's what's left.

## Time-sensitive

Nothing. Checked the Squarespace account on 2026-09-04 — see below.

## Coaching page — shipped

- [x] **Practical details filled in** (2026-09-10): 60-minute sessions by video,
      once a month, three-month start (three sessions), $200 a session / $600
      for the three months, free 20-minute intro call, currently open.
      A test now fails if any page ships an unresolved TODO or placeholder.

- [x] **Indexing — not needed** (checked 2026-09-10). Both `/coaching` and
      `/projects` already show "URL is on Google · Page is indexed", crawled by
      Googlebot smartphone at 4:33 PM and 4:32 PM the same day — after the last
      content change to either. Crawl allowed, fetch successful, indexing
      allowed, and Google's selected canonical matches the declared one on both.
      Discovery was via `sitemap.xml`, so submitting it did the job on its own.

      The Pages report still reads "3 indexed" because its aggregate data was
      last built 9/3, before those pages existed. It catches up on its own — URL
      Inspection is the live view.

      Also confirmed: the 3 "Not found (404)" entries are stale migration
      artifacts (`/home`, `http://www.`, and the apex), all crawled Aug 16–28
      during the Squarespace window. All three now 308 to the canonical www URL
      and Google has already started re-validating.

- [ ] **Revisit the monthly cadence once you have clients.** Three sessions
      over three months is sparse against a market norm of six to nine, and it
      caps a client at $600 where biweekly would be $1,200 at the same rate.
      Deliberate choice as a low-commitment entry offer — worth re-testing once
      you know whether momentum holds across four-week gaps.

## Photo rights — settled

- [x] **Leadville portrait** — permission from the photographer, credited on
      the coaching page to @marine.brichard (2026-09-08).
- [x] **Kettle Moraine finish (Jennifer Thorsen)** — removed rather than
      chased. It came from a free finisher download on a SmugMug sales
      portfolio, which normally licences personal use only, and this site sells
      coaching. Replaced with Ory's own summit photo (2026-09-08). Note the
      file remains in git history even though it no longer ships; if that ever
      matters it would need a history rewrite.
- [x] **Summit photos** — Ory's own iPhone shots, no question.

The remaining unused race photos in ~/Downloads (`AK2A*` shot on a Canon EOS
R5m2, `DSC_3993` with the Kettle logo burned in) carry the same licensing
question. Don't add them without permission.

## Worth doing soon

- [x] **Analytics — added 2026-09-10.** Vercel Web Analytics for page views
      (a first-party script, so the zero-third-party-requests property holds),
      plus a `/go/<slug>` redirect through `api/go.mjs` that counts outbound
      clicks server-side and works with JavaScript off. See **Measurement** in
      README.md.

      **Still needs one manual step:** switch on Web Analytics in the Vercel
      dashboard (Project → Analytics → Enable). Until then the script 404s and
      only the `/go/` half is recording anything.

- [ ] **Never rename a `/go/` slug.** Instagram's bio links point at
      `/go/medaling-with-friends` and `/go/ice-cycles` directly, so a rename
      breaks a live link on a platform this repo cannot reach. Add a slug,
      keep the old one.

- [ ] **Route the footer and /projects outbound links through `/go/` too.**
      Only the cards on `/links` are counted right now. The footer LinkedIn and
      Instagram links appear on every page and the project pages link out to
      MWF, IceCycles and both podcast apps — all invisible until they go
      through the counter. Add slugs to `DESTINATIONS` first.

- [ ] **Decide where the click log goes.** `vercel logs` keeps 30 days on Pro
      and has no aggregation, so "which link won last quarter" is currently
      unanswerable from the server-side half. A log drain, or writing to a
      store, is the fix if that question starts mattering.

- [x] **Search Console checked 2026-09-10.** Every indexable page resolved;
      `/coaching` and `/projects` confirmed indexed with Google's canonical
      matching ours. Zero clicks and zero impressions so far, which is expected
      six days in with no inbound links — that's the growth constraint, not
      indexing. Worth another look in a month once there's data to read.

## Known limitations, fix if they bite

- [ ] **The no-JS failure redirect goes nowhere useful.** On a failure without
      an `Accept: application/json` header the handler 303s to
      `/contact?error=<message>`, but nothing on any page reads that parameter.
      A visitor without JS lands on a blank, reset form with a cryptic query
      string and their message gone — and one who submitted from the home page
      is thrown onto a different page entirely. Either wire up a reader (a
      `:target`-based message works without JS) or drop the param and redirect
      plain.

- [ ] **The contact form has no rate limiting.** A honeypot field catches naive
      bots, and Resend's free tier caps at 100/day, but a determined spammer
      could still fill your inbox. If that happens, add a simple IP-based limit
      or turn on a captcha. Not worth pre-solving.

- [ ] **Fonts are substitutes.** Headings use Fredoka and body uses Nunito,
      standing in for Omnes Pro, which is Adobe-licensed through Squarespace
      and can't legally be self-hosted without an Adobe plan. If you ever get
      one, swap the kit `<link>` into each page's `<head>` and change
      `--font-heading` / `--font-body` in `assets/css/style.css`.

- [ ] **DMARC is at `p=none`.** That's report-only — it detects spoofing but
      doesn't stop it. Once you've been sending a while with no surprises in
      the reports, consider tightening to `p=quarantine`. No rush at this
      volume.

- [ ] **Header and footer are duplicated across every page.** That's now the
      main argument for a static site generator (Eleventy or Astro) — this many
      copies of a nav is roughly where hand-maintenance starts costing more
      than the toolchain would.

## Done

- [x] Rebuild the original Squarespace pages (home, about, contact) plus 404
      and thanks as static HTML/CSS
- [x] Self-host fonts and images; convert images to responsive WebP
- [x] Contact form via Resend serverless function, tested end to end
- [x] Deploy to Vercel, upgrade to Pro (commercial use)
- [x] Transfer domain Squarespace → Porkbun
- [x] Rebuild the DNS zone: Vercel records, Resend records, DMARC
- [x] Email forwarding for `howdy@` and `ory@` → Gmail, both verified
- [x] Co-Active Practitioner badge on the About page, linked to Credly
- [x] Repositioned around endurance-athlete mindset coaching; added Coaching
      and Projects pages, race record, and the Hard Days podcast (2026-09-04)
- [x] Turn off Squarespace auto-renew, keep the paid term as rollback
- [x] Zero-dependency test suite: 93 tests, `node --test`, ~3s, CI on push.
      Mutation-tested — all six bugs that shipped during the build turn it red
      (2026-09-09)
- [x] Fixed the bugs the audit found: contact handler rejecting valid Buffer
      bodies, collapsed email paragraphs, non-focusable skip target, inert
      .button--disabled, invisible form focus ring, required pronouns field,
      truncated coaching og:description (2026-09-09)
- [x] Test emails from setup deleted (2026-09-09)
- [x] Credly badge reissued by CTI with the correct name; `about.html` points
      at the new badge id (2026-09-09)
- [x] Google Search Console: Domain property verified via DNS TXT, sitemap
      submitted and fetching successfully (2026-09-04)
- [x] Audited the Squarespace account for anything worth exporting (2026-09-04).
      Nothing was. Details:
      - The website subscription **expired 2026-08-07**, a month before the
        migration. Admin is read-only; Pages and site content are locked behind
        "subscribe to a website plan". Nothing can be exported without paying
        again — and nothing needs to be, since the rebuild is complete and was
        verified against the live site.
      - **Contacts: 3 total**, all from Oct–Nov 2024, none since. Two are
        obvious SEO spam (`dominatingkeywords`, `websolution9`); the third is
        ambiguous. 0 subscribers, 0 customers. No genuine enquiries lost.
      - The refund question is moot — the plan lapsed rather than renewing, so
        there was no recent charge to refund.
      - Turning off auto-renew was belt-and-braces on an already-expired plan.
        There was never a paid term left to use as a rollback.
