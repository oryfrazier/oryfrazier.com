/**
 * Contact form handler — Vercel Serverless Function.
 *
 * Posts the message to Resend. No npm dependencies: Resend's REST API is called
 * with global fetch, so the repo stays build-step-free.
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   RESEND_API_KEY   Resend API key
 *   EMAIL_FROM       Sender on a Resend-verified domain, e.g. "Ory Frazier
 *                    <howdy@oryfrazier.com>". The domain must be verified in
 *                    Resend before anything sends.
 *   CONTACT_TO       Where enquiries land, e.g. "oryfrazier@gmail.com"
 */

const FIELDS = ["name", "pronouns", "email", "message"];
const MAX_LENGTH = { name: 200, pronouns: 100, email: 320, message: 10000 };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseBody(raw, type) {
  if (!raw) return {};
  if (type.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

async function readBody(req) {
  // Vercel parses JSON and urlencoded bodies for us, but be defensive: a form
  // POST without JS arrives as urlencoded, fetch() sends FormData or JSON.
  // When Vercel does not recognise the content type it hands back the raw
  // Buffer (or a string) and has already drained the stream, so those have to
  // be parsed here rather than falling through to the stream path below.
  const type = req.headers["content-type"] || "";
  const body = req.body;

  if (typeof body === "string") return parseBody(body, type);
  if (ArrayBuffer.isView(body)) {
    return parseBody(Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8"), type);
  }
  if (body && typeof body === "object") return body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return parseBody(Buffer.concat(chunks).toString("utf8"), type);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const wantsJson = (req.headers.accept || "").includes("application/json");

  // Without JS the browser posts natively and we can only answer with a
  // redirect. Send them back to the form they used, at a fragment the page
  // reveals with :target — no script needed to show the message. The previous
  // `?error=` param was read by nothing, so a failed submission silently
  // dropped the visitor on a blank form with their message gone.
  let failFragment = "/contact#form-error";
  const fail = (status, message) =>
    wantsJson
      ? res.status(status).json({ error: message })
      : res.redirect(303, failFragment);

  let body;
  try {
    body = await readBody(req);
  } catch {
    return fail(400, "Could not read the submission.");
  }

  if (body._source === "home") failFragment = "/#form-error";

  // Honeypot: real people leave this empty.
  if (body._gotcha) {
    return wantsJson ? res.status(200).json({ ok: true }) : res.redirect(303, "/thanks");
  }

  const data = {};
  for (const field of FIELDS) {
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    if (value.length > MAX_LENGTH[field]) {
      return fail(400, `${field} is too long.`);
    }
    data[field] = value;
  }

  if (!data.name || !data.email || !data.message) {
    return fail(400, "Name, email, and message are required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return fail(400, "That email address doesn't look right.");
  }

  const { RESEND_API_KEY, EMAIL_FROM, CONTACT_TO } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM || !CONTACT_TO) {
    console.error("Contact form is missing Resend configuration.");
    return fail(500, "The form isn't configured yet.");
  }

  const source = body._source === "home" ? "home page" : "contact page";
  const lines = [
    `Name: ${data.name}`,
    data.pronouns ? `Pronouns: ${data.pronouns}` : null,
    `Email: ${data.email}`,
    "",
    data.message,
    "",
    `— sent from the ${source} at oryfrazier.com`,
  ].filter((line) => line !== null);

  const text = lines.join("\n");
  // Escape first, then turn breaks into markup, so blank-line-separated
  // paragraphs in the message survive as separate <p> elements.
  const html = escapeHtml(text)
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .filter((block) => block.trim() !== "")
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [CONTACT_TO],
        reply_to: data.email,
        subject: `oryfrazier.com — ${data.name}`,
        text,
        html,
      }),
    });

    if (!response.ok) {
      console.error("Resend rejected the message:", response.status, await response.text());
      return fail(502, "The message could not be sent.");
    }

    // Log the id Resend assigns. A 200 here only means Resend ACCEPTED the
    // message — delivery can still fail afterwards, and without this id there
    // is no way to find the message in Resend's dashboard to see why.
    try {
      const { id } = await response.json();
      console.log("Resend accepted the message:", id, "->", CONTACT_TO);
    } catch {
      console.log("Resend accepted the message (no id in response)");
    }
  } catch (error) {
    console.error("Resend request failed:", error);
    return fail(502, "The message could not be sent.");
  }

  return wantsJson ? res.status(200).json({ ok: true }) : res.redirect(303, "/thanks");
}
