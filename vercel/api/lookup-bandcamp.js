/**
 * Autofill da Bandcamp: riceve un link "https://<artista>.bandcamp.com/album/<slug>"
 * via query string (?url=...), scarica la pagina e ne estrae titolo, cover e
 * data di uscita già pronti per submit.html: { title, date, image, type }.
 *
 * Bandcamp non ha un'API pubblica per letture di terze parti (la loro API
 * ufficiale è riservata agli account Label per i propri dati di vendita), ma
 * ogni pagina album incorpora già i dati che ci servono in due meta tag:
 *   - <meta property="og:title"/"og:image"> - le stesse che genererebbero
 *     un'anteprima social del link
 *   - <meta name="description"> - contiene una frase tipo "Titolo by
 *     Artista, released 28 August 2026" da cui estraiamo la data
 * Estraiamo tutto con regex mirate sui singoli meta tag (mai un parsing/eval
 * di script della pagina) - stessa tecnica già usata nel fallback age-gate
 * di lookup-steam.js.
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

// Estrae il "content" di un <meta> tag cercando prima il tag per intero (via
// name="..."/property="..."), poi il content al suo interno - così funziona
// indipendentemente dall'ordine in cui Bandcamp scrive gli attributi (che
// non è sempre lo stesso, a differenza di quanto assunto in una prima
// versione di questo file).
function extractMetaContent(html, attr, value) {
  const tagMatch = html.match(new RegExp(`<meta[^>]*${attr}=["']${value}["'][^>]*>`, "i"));
  if (!tagMatch) return null;
  const contentMatch = tagMatch[0].match(/content=["']([^"']*)["']/i);
  return contentMatch ? contentMatch[1] : null;
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

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// La data non vive in un campo dati dedicato ma dentro la frase della
// <meta name="description">, tipo:
//   "<titolo> by <artista>, released 03 June 2025"      (già uscito)
//   "<titolo> by <artista>, releases February 27, 2026"  (in pre-order)
// Due ordini diversi (giorno-mese / mese-giorno) a seconda del verbo, quindi
// proviamo entrambi i pattern invece di assumerne uno solo.
function parseReleaseDateText(text) {
  let m = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/); // "03 June 2025"
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[1]).padStart(2, "0")}`;
  }

  m = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/); // "February 27, 2026"
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
  if (!isBandcampAlbumUrl(rawUrl)) {
    res.status(400).json({ ok: false, error: "Not a valid Bandcamp album URL." });
    return;
  }

  let resp;
  try {
    resp = await fetch(rawUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(5000),
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

  const ogTitle = extractMetaContent(html, "property", "og:title");
  if (!ogTitle) {
    res.status(404).json({ ok: false, error: "Couldn't read this Bandcamp page (unexpected layout)." });
    return;
  }

  const ogImage = extractMetaContent(html, "property", "og:image");
  /* const description = extractMetaContent(html, "name", "description");
  const dateTextMatch = description
    ? decodeHtmlEntities(description).match(/,\s*(?:released|releases)\s+(.+)$/i)
    : null;
    */
  
  const description = extractMetaContent(html, "name", "description");
  let releaseDate = "";

  if (description) {
    const cleanDesc = decodeHtmlEntities(description);
    const datePhraseMatch = cleanDesc.match(/(?:released|releases)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    
    if (datePhraseMatch) {
      releaseDate = parseReleaseDateText(datePhraseMatch[1].trim());
    }
  }
  
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({
    ok: true,
    title: formatTitle(decodeHtmlEntities(ogTitle)),
    // date: dateTextMatch ? parseReleaseDateText(dateTextMatch[1].trim()) : "", // "" se non trovata: da compilare a mano
    date: releaseDate,
    image: ogImage || "",
    type: "Album",
  });
}
