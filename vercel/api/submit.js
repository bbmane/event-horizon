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
 *   GITHUB_BRANCH  - opzionale, default "main" (branch da cui leggere data/tags.json)
 *   ALLOWED_ORIGIN - es. "https://bbmane.github.io"  (per il CORS)
 */

const VALID_TYPES = ["Movie", "TV Series", "Anime", "Video Game", "Manga", "Comic", "Book", "Album"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEN = { title: 150, url: 500, image: 500 };

// I tag vivono in data/tags.json nel repo (fonte unica, condivisa con
// index.html/submit.html e con sync_issues.py): li leggiamo da lì invece di
// tenerne una copia qui, così rinominare/aggiungere un tag non richiede un
// redeploy di questa function. Cache in memoria per pochi minuti, per non
// interrogare GitHub ad ogni singola submission.
const TAGS_TTL_MS = 5 * 60 * 1000;
let tagsCache = { byId: null, fetchedAt: 0 };

async function getActiveTagLabelsById() {
  const now = Date.now();
  if (tagsCache.byId && now - tagsCache.fetchedAt < TAGS_TTL_MS) {
    return tagsCache.byId;
  }

  const branch = process.env.GITHUB_BRANCH || "main";
  const url = `https://raw.githubusercontent.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/${branch}/data/tags.json`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Could not load tags.json: HTTP ${resp.status}`);
  }
  const tags = await resp.json();

  const byId = new Map();
  for (const tag of tags) {
    if (tag.active === false) continue;
    byId.set(tag.id, tag.label);
  }

  tagsCache = { byId, fetchedAt: now };
  return byId;
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function buildIssueBody({ type, date, url, image, tagLabels }) {
  const tagLines = tagLabels.map((t) => `- [x] ${t}`).join("\n");

  return [
    "### Type",
    type,
    "",
    "### Release date",
    // Campo opzionale: se non è stata ancora annunciata una data, usiamo lo
    // stesso placeholder "_No response_" che genera GitHub Issue Forms per
    // un campo facoltativo lasciato vuoto, così sync_issues.py (che già lo
    // riconosce per il campo immagine) lo interpreta correttamente e lascia
    // l'issue in sospeso finché un moderatore non aggiunge la data.
    date || "_No response_",
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
  const rawTags = Array.isArray(payload.tags) ? payload.tags.slice(0, 20) : [];

  if (!title || title.length > MAX_LEN.title) {
    res.status(400).json({ ok: false, error: "Missing or overly long title." });
    return;
  }
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ ok: false, error: "Invalid type." });
    return;
  }
  // La data è opzionale: se manca un annuncio ufficiale, la issue resta
  // "pending" finché qualcuno non la conosce. Se invece è stata inserita,
  // deve comunque essere una data valida in formato YYYY-MM-DD.
  if (date && (!DATE_RE.test(date) || Number.isNaN(new Date(date).getTime()))) {
    res.status(400).json({ ok: false, error: "Invalid date, use YYYY-MM-DD (or leave it blank if unannounced)." });
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
  let tagLabelsById;
  try {
    tagLabelsById = await getActiveTagLabelsById();
  } catch (err) {
    console.error("Tags fetch error", err);
    res.status(502).json({ ok: false, error: "Error loading the tag list, please try again later." });
    return;
  }

  const tagLabels = [];
  for (const t of rawTags) {
    const id = Number(t);
    if (!Number.isInteger(id) || !tagLabelsById.has(id)) {
      res.status(400).json({ ok: false, error: "Invalid tag." });
      return;
    }
    tagLabels.push(tagLabelsById.get(id));
  }

  const issueBody = buildIssueBody({ type, date, url, image, tagLabels });

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
