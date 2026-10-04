# Architecture

Technical documentation for how Event Horizon works under the hood. If you're just looking to browse the calendar or submit a release, see the main [README](README.md) instead.

## How it works

- Submissions come in as GitHub Issues, either via the `report-release.yml` template or through `submit.html`, which posts to a small serverless function (`vercel/api/submit.js`) that opens the issue on your behalf — no GitHub account needed.
- The release date is optional on submission. Entries without one stay `pending` until a moderator adds the date and approves them; if one is approved too early, `sync_issues.py` flags it `needs-fix` instead of processing it.
- Once a moderator approves an issue, an automated workflow (`sync_issues.py` + `merge.py`) folds it into the monthly release files under `/data` and regenerates `data/manifest.json`.
- Corrections go through a separate template and are not auto-processed: a moderator reopens the original `[Release]` issue, fixes the data there, and re-approves it, so the correction flows through the same sync pipeline.
- A guard job (`guard_labels.py`) watches for the `approved` label being applied to anything that isn't a `[Release]` issue, and reverts it with an explanatory comment — this keeps the sync pipeline from choking on issues it can't parse.
- Another guard job (`guard_title.py`) restores the `[Release]` / `[Correction]` title prefix if a submitter deletes it, since both `sync_issues.py` and `guard_labels.py` rely on it to identify the issue type.
- `index.html` reads the monthly files directly and renders the calendar — no backend, no database, just static JSON served through GitHub Pages. Filters and the current month are mirrored in the URL (e.g. `?m=2026-11&type=anime,game&tag=4,5`), so any view can be shared as a link, and the browser's back button walks through month changes.
- The month strip at the top of `index.html` highlights which months contain releases matching the current filters. To avoid downloading every monthly file, it reads `data/manifest.json` instead (see below).
- `submit.html` can autofill title, date, cover and type from a pasted link (Steam, AniList, Bandcamp, TMDB) by calling `vercel/api/lookup-<source>.js` (see [Autofill endpoints](#autofill-endpoints)). Autofill is Vercel-only: the Cloudflare worker only handles submissions.

## Data files

| File                 | What it is                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `data/YYYY-MM.json`  | Releases of that month: `id`, `type`, `title`, `date`, `source_url`, `tags` (ids), optional `image_url`. |
| `data/tags.json`     | Tag ids/labels (see [Tags](#tags)).                                                                      |
| `data/manifest.json` | **Generated.** For each month, only `[type, tags]` of each release.                                      |

### The manifest

`data/manifest.json` exists only for the month strip: it lets `index.html` know which months have releases matching the current filters with a single small fetch. It looks like:

```json
{
  "2026-11": [
    ["series", [14]],
    ["movie", [7, 11, 13]]
  ],
  "2026-12": [["game", [1, 2, 3]]]
}
```

`merge.py` rebuilds it automatically whenever monthly files change (`merge_events` from the sync workflow, `merge_tags` from the tag-merge workflow). If you edit a monthly file **by hand**, regenerate it with:

```
python merge.py
```

A stale manifest isn't dangerous (the calendar itself reads the monthly files), but the month strip will highlight the wrong months.

## Tags

Every tag lives in a single source of truth, `data/tags.json` (`{id, label, active}`), so a rename or a new tag only has to be written in one place instead of several:

- `index.html` and `submit.html` fetch it at runtime to build the filter chips / checkboxes.
- `vercel/api/submit.js` and `worker/worker.js` fetch it (with a short cache) to validate submitted tags server-side.
- `sync_issues.py` reads it locally to resolve a checked box in an issue body to its tag id.

Releases in `/data` store tag **ids**, not text, so renaming a tag's label updates every past and future release using it automatically, with no data migration needed.

The one exception is `.github/ISSUE_TEMPLATE/report-release.yml`: GitHub Issue Forms are static YAML and can't read `tags.json` at runtime, so its checkbox options have to be kept in sync by hand. The **"Check tags sync"** workflow (`tools/check_tags_sync.py`) catches a missed update automatically whenever `tags.json` or the template change.

Merging two existing tags into one is the only case that rewrites historical data, so it's handled by a separate, manually-triggered workflow: **"Merge tags"** (`tools/merge_tags.py`), run from the Actions tab with the two tag ids as input.

### Common tag operations

| Task           | Steps                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| Add a tag      | Add an entry to `data/tags.json` + a matching checkbox in `report-release.yml`.          |
| Rename a tag   | Change `label` in `data/tags.json` + update the checkbox text in `report-release.yml`.   |
| Remove a tag   | Set `active: false` in `data/tags.json` + remove the checkbox from `report-release.yml`. |
| Merge two tags | Run the "Merge tags" GitHub Action with the two tag ids.                                 |

## Autofill endpoints

When a pasted source link matches a supported site, `submit.html` shows an "autofill" button that calls the matching serverless endpoint and pre-fills the form. All endpoints live in `vercel/api/`, are `GET`, take the link as `?url=...`, and return `{ ok, title, date, image, type }`. `date` is left empty whenever it can't be determined reliably, so the user fills it in by hand rather than risking a wrong one.

| Endpoint             | Source                  | Notes                                                                                                                                                                    |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lookup-steam.js`    | Steam Store API         | Falls back to scraping the store page for age-gated games. Always returns `Video Game`.                                                                                  |
| `lookup-anilist.js`  | AniList GraphQL         | Knows Anime vs Manga natively, so `type` is reliable.                                                                                                                    |
| `lookup-bandcamp.js` | Bandcamp page meta tags | Title/cover from `og:` tags, date parsed from the `description` meta. Always returns `Album`.                                                                            |
| `lookup-tmdb.js`     | TMDB API                | Needs the `TMDB_TOKEN` env var. Can't tell anime from movies/series, so `submit.html` shows a hint. For series, `date` is the very first air date, not the new season's. |

Only `TMDB_TOKEN` is a new env var; the others reuse `ALLOWED_ORIGIN` already set for `/api/submit`. Successful lookups are cached at the Vercel edge for an hour.

**To add a source:** create `vercel/api/lookup-<id>.js` and add an entry (`id`, `label`, `matches`, optional `hint`) to `AUTOFILL_SOURCES` in `submit.html`. If the source requires attribution, add it to `about.html` too.

## Licensing

- **Code** is under AGPLv3 (`/LICENSE`).
- **Data** (everything under `/data`) is under CC BY-NC-ND 4.0 (`data/LICENSE`).
- `about.html` carries the credits for the autofill sources, including the attribution TMDB requires (`tmdb-logo.svg`).

## Project structure

```
index.html                                   the calendar itself (month strip, filters, URL state)
submit.html                                  lightweight submission form with link autofill
about.html                                   what this is, credits (TMDB attribution), licenses
tmdb-logo.svg                                TMDB logo, required by their attribution rules
merge.py                                     merges approved releases into the monthly data files and rebuilds the manifest
sync_issues.py                               syncs approved GitHub Issues into the merge pipeline
guard_labels.py                              reverts "approved" mistakenly applied outside [Release] issues
guard_title.py                               restores the "[Release]"/"[Correction]" title prefix if removed
LICENSE                                      AGPLv3 (code)
data/                                        monthly release data (YYYY-MM.json)
data/tags.json                               single source of truth for tag ids/labels
data/manifest.json                           generated per-month [type, tags] index for the month strip
data/LICENSE                                 CC BY-NC-ND 4.0 (data)
tools/check_tags_sync.py                     fails CI if the issue template and tags.json disagree
tools/merge_tags.py                          merges two existing tags into one (run manually)
vercel/                                      Vercel project: serverless functions behind submit.html
vercel/api/submit.js                         validates a submission and opens the GitHub issue
vercel/api/lookup-*.js                       autofill endpoints (steam, anilist, bandcamp, tmdb)
vercel/DEPLOY-vercel.md                      deploy instructions and env vars
worker/                                      Cloudflare Worker alternative to the Vercel submit function (no autofill)
.github/ISSUE_TEMPLATE/report-release.yml    "Submit a release" issue template
.github/ISSUE_TEMPLATE/report-correction.yml "Report a correction" issue template
.github/workflows/sync.yml                   sync + label/title guard workflows
.github/workflows/check-tags.yml             checks tags.json vs. the issue template on every change
.github/workflows/merge-tags.yml             manually-triggered tag merge
```
