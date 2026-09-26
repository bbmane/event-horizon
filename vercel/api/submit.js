/**
 * Riceve il POST dal form submit.html e apre una issue su GitHub
 * identica, nel formato, a quella generata dal template
 * "Report a release" — così sync_issues.py non ha bisogno di
 * nessuna modifica.
 *
 * Env vars da impostare nel progetto Vercel (Settings → Environment Variables):
 *   GITHUB_TOKEN   - fine-grained PAT, permesso "Issues: write" SOLO sul repo target
 *   GITHUB_OWNER   - es. "bbmane"
 *   GITHUB_REPO    - es. "event-horizon"
 *   ALLOWED_ORIGIN - es. "https://bbmane.github.io"  (per il CORS)
 */

const VALID_TYPES = ["Movie", "TV Series", "Anime", "Video Game", "Manga", "Comic", "Book", "Album"];
const VALID_TAGS = new Set([
  "Aliens & First Contact",
  "Biopunk & Genetic Engineering",
  "Corporate Governments & Techno-Religions",
  "Cyberpunk",
  "Dystopian",
  "Hard Sci-Fi",
  "Kaiju & Tokusatsu",
  "Mecha",
  "Megastructures (Dyson spheres, orbital cities)",
  "Mind Control, Collective Consciousness & Telepathy",
  "Post-Apocalyptic & Alternative Histories",
  "Space Opera & Interplanetary Warfare",
  "Speculative Tech, Cybernetics, AI & Robotics",
  "Steampunk & Retrofuturism",
  "Time Travel & Space Exploration",
  "Transhumanism, Post-humanism & Mind Uploading",
  "Virtual Realities, Simulation & Multiverses",
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEN = { title: 150, url: 500, image: 500, tag: 80 };

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

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = process.env.ALLOWED_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", origin === allowed ? origin : allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const payload = req.body || {};

  // Honeypot: i bot tendono a compilare anche i campi nascosti.
  if (payload.website) {
    res.status(200).json({ ok: true, issue_number: 0 });
    return;
  }

  const title = (payload.title || "").trim();
  const type = (payload.type || "").trim();
  const date = (payload.date || "").trim();
  const url = (payload.url || "").trim();
  const image = (payload.image || "").trim();
  const tags = Array.isArray(payload.tags) ? payload.tags.slice(0, 20) : [];

  if (!title || title.length > MAX_LEN.title) {
    res.status(400).json({ ok: false, error: "Missing or overly long title." });
    return;
  }
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ ok: false, error: "Invalid type." });
    return;
  }
  if (!DATE_RE.test(date) || Number.isNaN(new Date(date).getTime())) {
    res.status(400).json({ ok: false, error: "Invalid date, use YYYY-MM-DD." });
    return;
  }
  if (!isHttpUrl(url) || url.length > MAX_LEN.url) {
    res.status(400).json({ ok: false, error: "Invalid source link." });
    return;
  }
  if (image && (!isHttpUrl(image) || image.length > MAX_LEN.image)) {
    res.status(400).json({ ok: false, error: "Invalid image URL." });
    return;
  }
  for (const t of tags) {
    if (typeof t !== "string" || !VALID_TAGS.has(t)) {
      res.status(400).json({ ok: false, error: "Invalid tag." });
      return;
    }
  }

  const issueBody = buildIssueBody({ type, date, url, image, tags });

  const ghResp = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "event-horizon-submit-function",
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
    res.status(502).json({ ok: false, error: "Error creating the issue, please try again later." });
    return;
  }

  const issue = await ghResp.json();
  res.status(200).json({ ok: true, issue_number: issue.number });
}
