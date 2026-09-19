/**
 * Riceve il POST dal form submit.html e apre una issue su GitHub
 * identica, nel formato, a quella generata dal template
 * "Report a release" — così sync_issues.py non ha bisogno di
 * nessuna modifica.
 *
 * Env vars richieste (impostale con `wrangler secret put` / vars):
 *   GITHUB_TOKEN   - fine-grained PAT, permesso "Issues: write" SOLO sul repo target
 *   GITHUB_OWNER   - es. "bbmane"
 *   GITHUB_REPO    - es. "event-horizon"
 *   ALLOWED_ORIGIN - es. "https://bbmane.github.io"  (per il CORS)
 */

const VALID_TYPES = ["Movie", "TV Series", "Anime", "Video Game", "Manga", "Album"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEN = { title: 150, url: 500, image: 500, tag: 80 };

function corsHeaders(origin, allowedOrigin) {
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function buildIssueBody({ type, date, url, image, tags }) {
  const tagLines = tags.map((t) => `- [x] ${t}`).join("\n");

  return [
    "### Type",
    type,
    "",
    "### Release date",
    date,
    "",
    "### Source link",
    url,
    "",
    "### Cover / poster image URL (optional)",
    image || "_No response_",
    "",
    "### Sci-Fi Tags & Themes",
    tagLines || "_No response_",
  ].join("\n");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, cors);
    }

    // Honeypot: i bot tendono a compilare anche i campi nascosti.
    if (payload.website) {
      // Rispondiamo "ok" per non far capire ai bot che sono stati filtrati.
      return jsonResponse({ ok: true, issue_number: 0 }, 200, cors);
    }

    const title = (payload.title || "").trim();
    const type = (payload.type || "").trim();
    const date = (payload.date || "").trim();
    const url = (payload.url || "").trim();
    const image = (payload.image || "").trim();
    const tags = Array.isArray(payload.tags) ? payload.tags.slice(0, 20) : [];

    if (!title || title.length > MAX_LEN.title) {
      return jsonResponse({ ok: false, error: "Missing or overly long title." }, 400, cors);
    }
    if (!VALID_TYPES.includes(type)) {
      return jsonResponse({ ok: false, error: "Invalid type." }, 400, cors);
    }
    if (!DATE_RE.test(date) || Number.isNaN(new Date(date).getTime())) {
      return jsonResponse({ ok: false, error: "Invalid date, use YYYY-MM-DD." }, 400, cors);
    }
    if (!isHttpUrl(url) || url.length > MAX_LEN.url) {
      return jsonResponse({ ok: false, error: "Invalid source link." }, 400, cors);
    }
    if (image && (!isHttpUrl(image) || image.length > MAX_LEN.image)) {
      return jsonResponse({ ok: false, error: "Invalid image URL." }, 400, cors);
    }
    for (const t of tags) {
      if (typeof t !== "string" || t.length > MAX_LEN.tag) {
        return jsonResponse({ ok: false, error: "Invalid tag." }, 400, cors);
      }
    }

    const issueBody = buildIssueBody({ type, date, url, image, tags });

    const ghResp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "event-horizon-submit-worker",
        },
        body: JSON.stringify({
          title: `[Release] ${title}`,
          body: issueBody,
          labels: ["pending"],
        }),
      }
    );

    if (!ghResp.ok) {
      const errText = await ghResp.text();
      console.error("GitHub API error", ghResp.status, errText);
      return jsonResponse(
        { ok: false, error: "Error creating the issue, please try again later." },
        502,
        cors
      );
    }

    const issue = await ghResp.json();
    return jsonResponse({ ok: true, issue_number: issue.number }, 200, cors);
  },
};
