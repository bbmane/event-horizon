/**
 * Autofill da Bandcamp: riceve un link "https://<artista>.bandcamp.com/album/<slug>"
 * via query string (?url=...), scarica la pagina e ne estrae titolo, cover e
 * data di uscita già pronti per submit.html: { title, date, image, type }.
 *
 * Bandcamp non ha un'API pubblica per letture di terze parti (la loro API
 * ufficiale è riservata agli account Label per i propri dati di vendita), ma
 * ogni pagina album incorpora già i dati che ci servono in due punti:
 *   - i tag Open Graph (<meta property="og:title">, "og:image") - gli stessi
 *     che genererebbero un'anteprima social del link
 *   - il campo "album_release_date" dentro il blob JS "TralbumData" che la
 *     pagina embedda per far funzionare il player
 * Estraiamo entrambi con regex mirate sui singoli valori (mai un parsing/eval
 * dell'intero blob JS, che sarebbe eseguire codice di una pagina esterna) -
 * stessa tecnica già usata nel fallback age-gate di lookup-steam.js.
 *
 * Nessuna env var nuova richiesta: riusa ALLOWED_ORIGIN già impostata per
 * /api/submit.
 */

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = process.env.ALLOWED_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", origin === allowed ? origin : allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isBandcampAlbumUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  // Sottodomini artista tipo "mcrecordings.bandcamp.com", non bandcamp.com
  // nudo (che è il sito principale, non una pagina album).
  return /\.bandcamp\.com$/.test(u.hostname) && u.hostname !== "bandcamp.com" && /\/album\//.test(u.pathname);
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// og:title su Bandcamp è quasi sempre nel formato "<Album>, by <Artista>":
// lo riportiamo a "<Artista> - <Album>", la convenzione già usata per le
// voci album esistenti sul calendario. Se non matcha quel pattern (casi
// particolari), lasciamo il titolo così com'è invece di romperlo.
function formatTitle(ogTitle) {
  const match = ogTitle.match(/^(.+?),\s*by\s+(.+)$/);
  return match ? `${match[2]} - ${match[1]}` : ogTitle;
}

// "album_release_date" nel blob TralbumData è nel formato
// "07 Sep 2026 00:00:00 GMT" - standard, parseable direttamente da Date().
function parseReleaseDate(text) {
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
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
  if (!isBandcampAlbumUrl(rawUrl)) {
    res.status(400).json({ ok: false, error: "Not a valid Bandcamp album URL." });
    return;
  }

  let resp;
  try {
    resp = await fetch(rawUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
  } catch (err) {
    console.error("Bandcamp fetch error", err);
    res.status(502).json({ ok: false, error: "Could not reach Bandcamp, please try again." });
    return;
  }

  if (!resp.ok) {
    res.status(404).json({ ok: false, error: "Bandcamp couldn't find this album (removed or invalid link)." });
    return;
  }

  const html = await resp.text();

  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
  if (!titleMatch) {
    res.status(404).json({ ok: false, error: "Couldn't read this Bandcamp page (unexpected layout)." });
    return;
  }

  const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  const dateMatch = html.match(/album_release_date"?\s*:\s*"([^"]+)"/);

  res.status(200).json({
    ok: true,
    title: formatTitle(decodeHtmlEntities(titleMatch[1])),
    date: dateMatch ? parseReleaseDate(dateMatch[1]) : "", // "" se non trovata: da compilare a mano
    image: imageMatch ? imageMatch[1] : "",
    type: "Album",
  });
}
