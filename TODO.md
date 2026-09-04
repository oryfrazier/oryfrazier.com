# Loose ends

Migration off Squarespace finished 2026-09-04. The site is live at
https://www.oryfrazier.com, on Vercel, with DNS and email forwarding at
Porkbun. Nothing below is blocking — it's what's left.

## Time-sensitive

Nothing. Checked the Squarespace account on 2026-09-04 — see below.

## Waiting on someone else

- [ ] **Credly badge name.** CTI was asked to change the holder name from
      "Gregory Frazier" to match the site. If they *edit* the record, the link
      in `about.html` keeps working and there's nothing to do. If they
      **reissue** the badge, the badge ID changes and the URL in `about.html`
      needs updating.

## Worth doing soon

- [ ] **Analytics — deferred by choice (2026-09-04).** Squarespace had built-in
      stats; this site has none, so there's no visibility into on-site
      behaviour. Search Console now covers the "how did people find me" half.
      If you want the rest later: Vercel Web Analytics (one script, already
      part of the platform) or Plausible / Fathom if you'd rather it be
      privacy-first and off Vercel. The site currently makes zero third-party
      requests — worth preserving that if you can.

- [ ] **Check Search Console in a week or two.** Confirm all 3 pages show as
      indexed under Pages, and that Performance is recording impressions. The
      URLs are unchanged from Squarespace, so rankings should carry — this is
      how you'd find out if they didn't.

## Known limitations, fix if they bite

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

- [ ] **Header and footer are duplicated across five pages.** Fine at this
      size. If the page count grows, move to Eleventy or Astro rather than
      keeping them in sync by hand.

## Housekeeping

- [ ] **Delete the test emails.** Four test submissions were sent during setup
      (three from the `.vercel.app` URL, one from the live domain). They're
      from "Claude (test submission)" and similar.

## Done

- [x] Rebuild all three pages plus 404 and thanks as static HTML/CSS
- [x] Self-host fonts and images; convert images to responsive WebP
- [x] Contact form via Resend serverless function, tested end to end
- [x] Deploy to Vercel, upgrade to Pro (commercial use)
- [x] Transfer domain Squarespace → Porkbun
- [x] Rebuild the DNS zone: Vercel records, Resend records, DMARC
- [x] Email forwarding for `howdy@` and `ory@` → Gmail, both verified
- [x] Co-Active Practitioner badge on the About page, linked to Credly
- [x] Turn off Squarespace auto-renew, keep the paid term as rollback
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
