/**
 * Autofill da Backloggd: riceve un link "https://backloggd.com/games/<slug>/"
 * via query string (?url=...), scarica la pagina e ne estrae titolo, cover e
 * data di uscita già pronti per submit.html: { title, date, image, type }.
 *
 * Backloggd non ha un'API pubblica, quindi come per Bandcamp leggiamo la
 * pagina HTML con regex mirate (mai un parsing/eval di script):
 *   - <meta property="og:title"/"og:image"> per titolo e cover
 *   - il primo link "/games/lib/release_year:<anno>" della pagina, il cui
 *     testo è la data di uscita (es. "Sep 16, 2026")
 * Le cover di Backloggd sono quelle di IGDB: le riportiamo al formato
 * "t_cover_big_2x", lo stesso già usato dalle voci esistenti sul calendario.
 *
 * "type" è sempre "Video Game". "date" è "" se Backloggd mostra solo
 * l'anno o "TBD": il campo resta da compilare a mano, senza indovinare.
 *
 * ATTENZIONE: Backloggd è dietro Cloudflare e può rispondere 403 agli IP dei
 * datacenter. In quel caso l'endpoint ritorna un errore pulito e l'utente
 * compila il form a mano.
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

// https://backloggd.com/games/hades-ii/ -> "hades-ii"
// Escludiamo le pagine che non sono un gioco (/games/lib/..., ecc.).
const NON_GAME_SLUGS = new Set(["lib", "popular", "trending", "shuffle", "search"]);

function extractSlug(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.hostname !== "backloggd.com" && u.hostname !== "www.backloggd.com") return null;

  const match = u.pathname.match(/^\/games\/([A-Za-z0-9][A-Za-z0-9._%-]*)\/?/);
  if (!match || NON_GAME_SLUGS.has(match[1].toLowerCase())) return null;
  return match[1];
}

// Cerca prima il tag <meta> per intero, poi il content al suo interno, così
// funziona qualunque sia l'ordine degli attributi.
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
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// Backloggd mostra la data come "Sep 16, 2026" (a volte solo "2026" o "TBD").
// Accettiamo solo formati con giorno+mese+anno espliciti; il resto torna "".
function parseReleaseDateText(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();

  let m = cleaned.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/); // "Sep 16, 2026"
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[2]).padStart(2, "0")}`;
  }

  m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/); // "16 Sep 2026"
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${String(m[1]).padStart(2, "0")}`;
  }

  return "";
}

// Backloggd mette l'anno di uscita tra parentesi nell'og:title:
// "Metroid Ravenous (2027) | Backloggd" -> "Metroid Ravenous".
// Se serve disambiguare un remake, il titolo si ritocca a mano nel form.
function cleanTitle(ogTitle) {
  return decodeHtmlEntities(ogTitle)
    .replace(/\s*[|\-–—]\s*Backloggd\s*$/i, "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .trim();
}

// Porta la cover IGDB al formato verticale grande già usato nel calendario.
function normalizeCover(src) {
  if (!src) return "";
  let url = decodeHtmlEntities(src).trim();
  if (url.startsWith("//")) url = `https:${url}`;
  if (/^https:\/\/images\.igdb\.com\//.test(url)) {
    url = url.replace(/\/t_[a-z0-9_]+\//, "/t_cover_big_2x/");
  }
  return /^https?:\/\//.test(url) ? url : "";
}

function htmlToText(fragment) {
  return decodeHtmlEntities(
    fragment
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

const DATE_SRC = "([A-Za-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]{3,9}\\.?,?\\s+\\d{4})";

// Il badge con la data ("Upcoming  Jan 28, 2027" / "Released ...") sta nella
// testata della pagina, subito dopo il titolo <h1>. Non conoscendo il markup
// esatto, proviamo in ordine, dal più al meno affidabile:
//   1. link /games/lib/release_year:<anno> con una data completa come testo
//   2. etichetta "Upcoming" / "Released" seguita da una data, nella testata
//   3. la prima data completa nei primi caratteri di testo dopo l'<h1>
//      (abbastanza stretto da non pescare date dalla descrizione o dalle review)
// Se non c'è una data completa (solo anno, "TBD") ritorna "".
function findReleaseDate(html) {
  const link = html.match(
    /<a[^>]+href=["']\/games\/lib\/release_year:\d{4}[^"']*["'][^>]*>\s*([^<]+?)\s*<\/a>/i
  );
  if (link) {
    const d = parseReleaseDateText(decodeHtmlEntities(link[1]));
    if (d) return d;
  }

  const h1 = html.search(/<h1[\s>]/i);
  if (h1 < 0) return "";
  const header = htmlToText(html.slice(h1, h1 + 8000));

  const labelled = header.match(
    new RegExp(`(?:Upcoming|Released(?:\\s+on)?|Release\\s+date)\\s*:?\\s*${DATE_SRC}`, "i")
  );
  if (labelled) {
    const d = parseReleaseDateText(labelled[1]);
    if (d) return d;
  }

  const near = header.slice(0, 300).match(new RegExp(DATE_SRC));
  return near ? parseReleaseDateText(near[1]) : "";
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
  const slug = extractSlug(rawUrl);
  if (!slug) {
    res.status(400).json({ ok: false, error: "Not a valid Backloggd game URL." });
    return;
  }

  let resp;
  try {
    // Ricostruiamo noi l'URL dallo slug validato invece di fetchare quello
    // dell'utente così com'è.
    resp = await fetch(`https://backloggd.com/games/${slug}/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("Backloggd fetch error", err);
    res.status(502).json({ ok: false, error: "Could not reach Backloggd, please try again." });
    return;
  }

  if (resp.status === 404) {
    res.status(404).json({ ok: false, error: "Backloggd couldn't find this game (removed or invalid link)." });
    return;
  }
  if (!resp.ok) {
    // 403/429/503: tipicamente il blocco anti-bot di Cloudflare
    console.error("Backloggd HTTP error", resp.status);
    res.status(502).json({ ok: false, error: "Backloggd blocked the lookup, please fill the form by hand." });
    return;
  }

  const html = await resp.text();

  const ogTitle = extractMetaContent(html, "property", "og:title");
  if (!ogTitle) {
    res.status(404).json({ ok: false, error: "Couldn't read this Backloggd page (unexpected layout)." });
    return;
  }

  const ogImage = extractMetaContent(html, "property", "og:image");

  const releaseDate = findReleaseDate(html);

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({
    ok: true,
    title: cleanTitle(ogTitle),
    date: releaseDate, // "" se non ricavabile con certezza: da compilare a mano
    image: normalizeCover(ogImage),
    type: "Video Game",
  });
}