/**
 * Autofill da TMDB: riceve un link "https://www.themoviedb.org/movie/<id>-slug"
 * o ".../tv/<id>-slug" via query string (?url=...), estrae id e tipo dal link,
 * interroga l'API pubblica di TMDB e ritorna i campi pronti per submit.html:
 * { title, date, image, type }.
 *
 * "type" è "Movie" o "TV Series" in base al link: TMDB non distingue gli anime
 * dal resto (un anime è solo un film/serie con genere Animation), quindi se
 * serve "Anime" l'utente lo cambia a mano - lo ricorda l'hint in submit.html.
 *
 * "date" è release_date per i film e first_air_date per le serie. Attenzione:
 * per una serie è la data del PRIMO episodio in assoluto, non della stagione
 * nuova che si sta segnalando - in quel caso va corretta a mano.
 *
 * Env var richiesta (Vercel -> Settings -> Environment Variables):
 *   TMDB_TOKEN - "API Read Access Token" (quello lungo, v4) da
 *                themoviedb.org -> Settings -> API. Viene inviato come Bearer,
 *                così non finisce mai in un URL.
 * Riusa inoltre ALLOWED_ORIGIN già impostata per /api/submit.
 */

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = process.env.ALLOWED_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", origin === allowed ? origin : allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// https://www.themoviedb.org/movie/1170608-dune-part-three/ -> { kind: "movie", id: "1170608" }
// https://www.themoviedb.org/tv/171802-blade-runner-2099     -> { kind: "tv", id: "171802" }
function parseTmdbUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.hostname !== "themoviedb.org" && u.hostname !== "www.themoviedb.org") return null;

  const match = u.pathname.match(/^\/(movie|tv)\/(\d+)/);
  return match ? { kind: match[1], id: match[2] } : null;
}

// Stesso formato poster già usato dalle voci esistenti sul calendario.
const POSTER_BASE = "https://image.tmdb.org/t/p/w600_and_h900_face";

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
  const parsed = parseTmdbUrl(rawUrl);
  if (!parsed) {
    res.status(400).json({ ok: false, error: "Not a valid TMDB movie/TV URL." });
    return;
  }

  if (!process.env.TMDB_TOKEN) {
    console.error("TMDB_TOKEN is not set");
    res.status(500).json({ ok: false, error: "TMDB lookup is not configured." });
    return;
  }

  let tmdbResp;
  try {
    tmdbResp = await fetch(
      `https://api.themoviedb.org/3/${parsed.kind}/${parsed.id}?language=en-US`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TMDB_TOKEN}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      }
    );
  } catch (err) {
    console.error("TMDB fetch error", err);
    res.status(502).json({ ok: false, error: "Could not reach TMDB, please try again." });
    return;
  }

  if (!tmdbResp.ok) {
    // 404 = id inesistente per quel tipo; 401 = token errato/scaduto (errore
    // nostro, non dell'utente); altro = problema/rate limit lato TMDB.
    if (tmdbResp.status === 404) {
      res.status(404).json({ ok: false, error: "TMDB couldn't find this entry (removed or invalid id)." });
      return;
    }
    console.error("TMDB API error", tmdbResp.status);
    res.status(502).json({ ok: false, error: "TMDB API error, please try again later." });
    return;
  }

  let data;
  try {
    data = await tmdbResp.json();
  } catch {
    res.status(502).json({ ok: false, error: "TMDB API error, please try again later." });
    return;
  }

  const isMovie = parsed.kind === "movie";
  const title = (isMovie ? data.title : data.name) || "";
  const rawDate = (isMovie ? data.release_date : data.first_air_date) || "";
  // Se TMDB non ha ancora una data completa ritorniamo "": il campo resta da
  // compilare a mano, invece di rischiare di inserirne una sbagliata.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : "";
  const image = data.poster_path ? `${POSTER_BASE}${data.poster_path}` : "";

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({
    ok: true,
    title,
    date,
    image,
    type: isMovie ? "Movie" : "TV Series",
  });
}
