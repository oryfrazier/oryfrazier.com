/**
 * Outbound click counter — Vercel Serverless Function.
 *
 * Every off-site link on /links points at /go/<slug> instead of at the
 * destination. This function logs the click and 302s onward, which is the only
 * way to count an outbound click that does not depend on the visitor running
 * JavaScript. `vercel.json` rewrites /go/:slug onto this file.
 *
 * The log line is one JSON object per click, readable with `vercel logs` or
 * pointed at a drain. It deliberately records no IP address and no user agent:
 * the question being answered is "which link gets clicked", and anything more
 * than that is data this site has no reason to hold.
 *
 * Adding a link means adding a slug here first — tests/deploy-config.test.mjs
 * fails if a page links at a slug this table does not define.
 */

export const DESTINATIONS = {
  "apple-podcasts": "https://podcasts.apple.com/us/podcast/hard-days/id1775795224",
  spotify: "https://open.spotify.com/show/68BUMp0pZD4fB1rbkAGJUu",
  "medaling-with-friends": "https://www.medalingwithfriends.com",
  "ice-cycles": "https://www.ice-cycles.com",
  instagram: "https://www.instagram.com/oryfrazier",
  linkedin: "https://www.linkedin.com/in/ory-frazier/",
};

/** Where an unknown slug lands. Never a 404: the link was shared in good faith. */
export const FALLBACK = "/links";

/**
 * The slug, from Vercel's parsed query when it is there and from the raw URL
 * when it is not. The fallback is what makes the handler testable without
 * standing up the platform's request parsing.
 */
export function slugFrom(req) {
  const fromQuery = req?.query?.slug;
  if (typeof fromQuery === "string" && fromQuery !== "") return fromQuery.toLowerCase();

  const url = String(req?.url ?? "");
  const match = /[?&]slug=([^&#]+)/.exec(url) ?? /(?:^|\/)go\/([^/?#]+)/.exec(url);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

export default function handler(req, res) {
  const slug = slugFrom(req);
  const known = Object.prototype.hasOwnProperty.call(DESTINATIONS, slug);
  const to = known ? DESTINATIONS[slug] : FALLBACK;

  console.log(
    JSON.stringify({
      event: known ? "outbound" : "outbound_unknown_slug",
      slug: slug === "" ? null : slug,
      to,
      referer: req?.headers?.referer ?? null,
      at: new Date().toISOString(),
    }),
  );

  // no-store, or the CDN and the browser cache the hop and every click after
  // the first never reaches this function — the count silently flatlines.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Location", to);
  // 302, never 301. A permanent redirect is cached by the browser for as long
  // as it likes, which both stops the counting and makes a destination change
  // unreachable for anyone who has clicked before.
  res.statusCode = 302;
  res.end();
}
