/**
 * Autofill da Steam: riceve un link "https://store.steampowered.com/app/<id>/..."
 * via query string (?url=...), estrae l'appid, interroga l'API pubblica
 * Steam Store (nessuna key richiesta) e ritorna i campi già pronti per
 * precompilare submit.html: { title, date, image, type }.
 *
 * "type" è sempre "Video Game" (valore fisso, coerente con VALID_TYPES di
 * submit.js) - serve solo perché il form possa preselezionare la dropdown.
 *
 * "date" è ricostruita a partire da release_date.date, che Steam restituisce
 * come testo libero ("16 Sep, 2026", "Coming soon", "Q4 2026", ecc.) e non
 * sempre in formato pieno giorno/mese/anno: se non riusciamo a ricavare una
 * data YYYY-MM-DD affidabile ritorniamo semplicemente "" e il campo resta
 * da compilare a mano, invece di rischiare di inserire una data sbagliata.
 *
 * Nessuna env var nuova richiesta: riusa ALLOWED_ORIGIN già impostata per
 * /api/submit.
 */

const ALLOWED_HOST = "store.steampowered.com";

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = process.env.ALLOWED_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", origin === allowed ? origin : allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function extractAppId(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.hostname !== ALLOWED_HOST && u.hostname !== `www.${ALLOWED_HOST}`) {
    return null;
  }
  const match = u.pathname.match(/\/app\/(\d+)/);
  return match ? match[1] : null;
}

// Steam ritorna release_date.date come testo libero, es:
//   "16 Sep, 2026"  |  "Sep 16, 2026"  |  "16 Sep 2026"  |  "Coming soon"  | "Q4 2026"
// Proviamo a riconoscere solo i formati con giorno+mese+anno espliciti;
// tutto il resto (date parziali o assenti) torna "" invece di indovinare.
function parseSteamDate(text) {
  if (!text) return "";
  const cleaned = text.replace(",", "").trim();

  let m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/); // "16 Sep 2026"
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[1]).padStart(2, "0")}`;
  }

  m = cleaned.match(/^([A-Za-z]{3,})\s+(\d{1,2})\s+(\d{4})$/); // "Sep 16 2026"
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[2]).padStart(2, "0")}`;
  }

  return "";
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const rawUrl = (req.query.url || "").toString().trim();
  const appId = extractAppId(rawUrl);
  if (!appId) {
    res.status(400).json({ ok: false, error: "Not a valid Steam store app URL." });
    return;
  }

  let steamResp;
  try {
    steamResp = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`,
      {
        // Senza questo cookie, l'API risponde "success: false" per i giochi
        // dietro age-check (18+/mature) invece dei dati veri - lo stesso
        // check che mostra il popup "conferma la tua età" sul sito.
        headers: { Cookie: "birthtime=0; lastagecheckage=1-0-1900; wants_mature_content=1" },
      }
    );
  } catch (err) {
    console.error("Steam fetch error", err);
    res.status(502).json({ ok: false, error: "Could not reach Steam, please try again." });
    return;
  }

  if (!steamResp.ok) {
    res.status(502).json({ ok: false, error: "Steam API error, please try again later." });
    return;
  }

  const body = await steamResp.json();
  const entry = body[appId];
  if (!entry || !entry.success || !entry.data) {
    res.status(404).json({ ok: false, error: "Steam couldn't find this app (removed, region-locked, or invalid id)." });
    return;
  }

  const data = entry.data;
  const releaseDate = parseSteamDate(data.release_date && data.release_date.date);
  const image = await resolveCoverImage(appId, data.header_image || "");

  res.status(200).json({
    ok: true,
    title: data.name || "",
    date: releaseDate, // "" se non ricavabile con certezza: l'utente la compila a mano
    image,
    type: "Video Game",
  });
}

// La "library capsule" (copertina verticale, il formato bello per una cover)
// vive a un URL fisso e prevedibile, costruibile dal solo appid, senza bisogno
// di alcuna chiamata API: https://cdn.cloudflare.steamstatic.com/steam/apps/<id>/library_600x900_2x.jpg
// Non tutti i giochi la hanno caricata (soprattutto titoli piccoli/vecchi), quindi
// verifichiamo con un HEAD prima di usarla, e in caso di assenza ripieghiamo
// sull'header_image (orizzontale) già presente nella risposta di appdetails.
async function resolveCoverImage(appId, fallback) {
  const libraryUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`;
  try {
    const head = await fetch(libraryUrl, { method: "HEAD" });
    if (head.ok) return libraryUrl;
  } catch {
    // rete/timeout: ripieghiamo silenziosamente sul fallback
  }
  return fallback;
}
