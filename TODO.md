# Loose ends

Migration off Squarespace finished 2026-09-04. The site is live at
https://www.oryfrazier.com, on Vercel, with DNS and email forwarding at
Porkbun. Nothing below is blocking — it's what's left.

## Time-sensitive

- [ ] **Export anything still living in Squarespace before the plan lapses.**
      Auto-renew is off, so the site goes dark on its own at the end of the paid
      term. Past contact-form submissions and any stored contacts exist only in
      Squarespace and disappear with it. Check for stored form responses,
      then export or screenshot what matters.
      Expiry date: `________` (fill this in from the billing panel)

- [ ] **Confirm no other Squarespace subscriptions are auto-renewing.**
      Acuity Scheduling, resold Google Workspace, anything else on the account
      renews independently of the website plan.

- [ ] **Ask Squarespace for a refund on the recent renewal.**
      Policy says no — the 14-day window covers new purchases only, not
      renewals, and there are no prorated refunds. Worth five minutes on the
      refund request form anyway as a goodwill ask. Don't count on it.

## Waiting on someone else

- [ ] **Credly badge name.** CTI was asked to change the holder name from
      "Gregory Frazier" to match the site. If they *edit* the record, the link
      in `about.html` keeps working and there's nothing to do. If they
      **reissue** the badge, the badge ID changes and the URL in `about.html`
      needs updating.

## Worth doing soon

- [ ] **Set up analytics.** Squarespace had built-in stats; this site has none,
      so right now there's no visibility into traffic at all. Options: Vercel
      Web Analytics (one script, already part of the platform) or Plausible /
      Fathom if you want something privacy-first and off Vercel. Currently the
      site makes zero third-party requests — worth preserving that if you can.

- [ ] **Google Search Console.** Verify ownership of the domain and submit
      `sitemap.xml`. The URLs are unchanged from Squarespace (`www`, `/about`,
      `/contact`), so rankings should carry over — but Search Console is how
      you'd find out if they didn't. Also worth confirming the old Squarespace
      verification isn't the only thing holding the property.

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
