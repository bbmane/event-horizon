/**
 * Autofill da AniList: riceve un link "https://anilist.co/anime/<id>/..." o
 * ".../manga/<id>/..." via query string (?url=...), estrae id e media type
 * dal link stesso, interroga la GraphQL pubblica di AniList (nessuna key
 * richiesta) e ritorna i campi pronti per submit.html: { title, date, image, type }.
 *
 * A differenza di TMDB, qui il "type" (Anime/Manga) non è un'ipotesi da
 * ricontrollare a mano: AniList lo sa già per ogni media, quindi lo
 * restituiamo direttamente e submit.html lo usa senza ambiguità.
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

// Il link stesso ci dice sia l'id AniList sia se è anime o manga:
// https://anilist.co/anime/21/ONE-PIECE  ->  { id: 21, mediaType: "ANIME" }
// https://anilist.co/manga/30013/...     ->  { id: 30013, mediaType: "MANGA" }
function parseAniListUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.hostname !== "anilist.co" && u.hostname !== "www.anilist.co") return null;

  const match = u.pathname.match(/^\/(anime|manga)\/(\d+)/);
  if (!match) return null;

  return { id: Number(match[2]), mediaType: match[1].toUpperCase() };
}

const QUERY = `
  query ($id: Int, $type: MediaType) {
    Media(id: $id, type: $type) {
      type
      title { romaji english }
      startDate { year month day }
      coverImage { extraLarge large }
    }
  }
`;

// AniList a volte conosce solo l'anno o anno+mese di uscita (specialmente
// per media non ancora annunciati nel dettaglio): ritorniamo "" se manca il
// giorno, invece di indovinarlo, esattamente come già facciamo per Steam.
function formatStartDate(startDate) {
  if (!startDate || !startDate.year || !startDate.month || !startDate.day) return "";
  const y = String(startDate.year).padStart(4, "0");
  const m = String(startDate.month).padStart(2, "0");
  const d = String(startDate.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  const parsed = parseAniListUrl(rawUrl);
  if (!parsed) {
    res.status(400).json({ ok: false, error: "Not a valid AniList anime/manga URL." });
    return;
  }

  let alResp;
  try {
    alResp = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { id: parsed.id, type: parsed.mediaType } }),
      signal: AbortSignal.timeout(5000),
  });
  } catch (err) {
    console.error("AniList fetch error", err);
    res.status(502).json({ ok: false, error: "Could not reach AniList, please try again." });
    return;
  }

  if (!alResp.ok) {
    // 404 = id inesistente per quel type; altri codici = errore/rate limit lato AniList
    const status = alResp.status === 404 ? 404 : 502;
    const error = status === 404
      ? "AniList couldn't find this entry (removed or invalid id)."
      : "AniList API error, please try again later.";
    res.status(status).json({ ok: false, error });
    return;
  }

  const body = await alResp.json();
  const media = body.data && body.data.Media;
  if (!media) {
    res.status(404).json({ ok: false, error: "AniList couldn't find this entry." });
    return;
  }

  const title = (media.title && (media.title.english || media.title.romaji)) || "";
  const image = (media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || "";
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  
  res.status(200).json({
    ok: true,
    title,
    date: formatStartDate(media.startDate),
    image,
    type: media.type === "MANGA" ? "Manga" : "Anime",
  });
}
