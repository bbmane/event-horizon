# Deploying the functions on Vercel

The site (`index.html` / `submit.html`) stays on GitHub Pages. Only this
`vercel/` folder becomes a separate Vercel project, exposing:

- `https://<your-project>.vercel.app/api/submit` — opens the release issue
- `https://<your-project>.vercel.app/api/lookup-<source>` — form autofill
  (`lookup-steam`, `lookup-anilist`, `lookup-bandcamp`, `lookup-tmdb`)

## 1. Create the GitHub PAT (minimal permissions)

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token

- Repository access: **Only select repositories** → `event-horizon`
- Permissions → **Issues: Read and write**
- Nothing else.

## 2. Get the TMDB token (only for movie/TV autofill)

themoviedb.org → Settings → API → copy the **API Read Access Token** (the long
one, v4). It's sent as a Bearer token, so it never ends up in a URL.

Without this token `/api/lookup-tmdb` responds "TMDB lookup is not configured";
everything else (submit and the other lookups) keeps working.

## 3. Create the project on Vercel

Two ways, pick whichever you prefer:

**A) From the dashboard (easiest):**

1. vercel.com → New Project → import the GitHub repo
2. When asked for the "Root Directory", select `vercel/`
3. Deploy

**B) From the CLI:**

```
npm install -g vercel
cd vercel
vercel
```

## 4. Set the environment variables

In the project on vercel.com → Settings → Environment Variables, add:

| Variable         | Required          | Value                                                                                                                  |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`   | yes               | the PAT created in step 1 (mark it as "Secret")                                                                        |
| `GITHUB_OWNER`   | yes               | `bbmane`                                                                                                               |
| `GITHUB_REPO`    | yes               | `event-horizon`                                                                                                        |
| `ALLOWED_ORIGIN` | yes               | `https://bbmane.github.io` (the exact origin the site is served from, no trailing slash). Also used by all the lookups |
| `TMDB_TOKEN`     | for `lookup-tmdb` | the token from step 2 (mark it as "Secret")                                                                            |
| `GITHUB_BRANCH`  | no                | branch to read `data/tags.json` from, defaults to `main`                                                               |

After adding them, redeploy (Settings → Deployments → "..." → Redeploy) so
the env vars take effect.

## 5. Connect the form to the functions

In `submit.html` there are two constants to point at your project:

```js
const WORKER_URL = "https://<your-project>.vercel.app/api/submit";
const LOOKUP_BASE_URL = "https://<your-project>.vercel.app/api";
```

`LOOKUP_BASE_URL` is the shared base: the form appends
`/lookup-<source>?url=...` on its own, depending on the pasted link.

## Testing

**Submit:**

```
curl -X POST https://<your-project>.vercel.app/api/submit \
  -H "Content-Type: application/json" \
  -H "Origin: https://bbmane.github.io" \
  -d '{"title":"Test Release","type":"Video Game","date":"2026-12-01","url":"https://example.com","image":"","tags":[4]}'
```

It should create a "[Release] Test Release" issue with the `pending` label on the repo.
(Tags are **numeric ids** from `data/tags.json`, e.g. `4` = Cyberpunk.)

**Autofill** (one per source, change the link):

```
curl "https://<your-project>.vercel.app/api/lookup-steam?url=https%3A%2F%2Fstore.steampowered.com%2Fapp%2F1637460%2FTankRat%2F"
```

It should respond `{"ok":true,"title":"TankRat","date":"...","image":"...","type":"Video Game"}`.
An empty `date` isn't an error: the source doesn't have a complete, certain date.

## Adding a new autofill source

1. Create `vercel/api/lookup-<id>.js` (use an existing one as a base): `GET`,
   link in `?url=`, response `{ ok, title, date, image, type }`.
2. Add an entry to `AUTOFILL_SOURCES` in `submit.html`.
3. If the source needs a key, add it above as an env var and redeploy.
4. If it requires attribution, add it to `about.html`.

## Differences from the Cloudflare version

- Same exact validation logic and same issue format for `submit`: no changes
  needed to `sync_issues.py` / `merge.py`.
- Autofill exists **only** on Vercel: the Cloudflare worker only handles
  submissions.
- Env vars are set from the dashboard instead of with `wrangler secret put`.
- Vercel's free plan has generous invocation/bandwidth limits, more than
  enough for a submission form like this one. Lookup responses are cached at
  the edge for an hour, so the same link doesn't repeatedly hit the source.

## Anti-spam note

The honeypot is already included in `submit`; if you need more, Vercel has no
free built-in rate limiting comparable to Cloudflare's — the simplest option
to add later is still **Cloudflare Turnstile** (invisible captcha), verified
on the function side.
