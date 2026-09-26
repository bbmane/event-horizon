# Architecture

Technical documentation for how Event Horizon works under the hood. If you're just looking to browse the calendar or submit a release, see the main [README](README.md) instead.

## How it works

- Submissions come in as GitHub Issues, either via the `report-release.yml` template or through `submit.html`, which posts to a small serverless function (`vercel/api/submit.js`) that opens the issue on your behalf — no GitHub account needed.
- Once a moderator approves an issue, an automated workflow (`sync_issues.py` + `merge.py`) folds it into the monthly release files under `/data`.
- Corrections go through a separate template and are not auto-processed: a moderator reopens the original `[Release]` issue, fixes the data there, and re-approves it, so the correction flows through the same sync pipeline.
- A guard job (`guard_labels.py`) watches for the `approved` label being applied to anything that isn't a `[Release]` issue, and reverts it with an explanatory comment — this keeps the sync pipeline from choking on issues it can't parse.
- Another guard job (`guard_title.py`) restores the `[Release]` / `[Correction]` title prefix if a submitter deletes it, since both `sync_issues.py` and `guard_labels.py` rely on it to identify the issue type.
- `index.html` reads the monthly files directly and renders the calendar — no backend, no database, just static JSON served through GitHub Pages.

## Tags

Every tag lives in a single source of truth, `data/tags.json` (`{id, label, active}`), so a rename or a new tag only has to be written in one place instead of several:

- `index.html` and `submit.html` fetch it at runtime to build the filter chips / checkboxes.
- `vercel/api/submit.js` and `worker/worker.js` fetch it (with a short cache) to validate submitted tags server-side.
- `sync_issues.py` reads it locally to resolve a checked box in an issue body to its tag id.

Releases in `/data` store tag **ids**, not text, so renaming a tag's label updates every past and future release using it automatically, with no data migration needed.

The one exception is `.github/ISSUE_TEMPLATE/report-release.yml`: GitHub Issue Forms are static YAML and can't read `tags.json` at runtime, so its checkbox options have to be kept in sync by hand. The **"Check tags sync"** workflow (`tools/check_tags_sync.py`) catches a missed update automatically whenever `tags.json` or the template change.

Merging two existing tags into one is the only case that rewrites historical data, so it's handled by a separate, manually-triggered workflow: **"Merge tags"** (`tools/merge_tags.py`), run from the Actions tab with the two tag ids as input.

### Common tag operations

| Task | Steps |
|---|---|
| Add a tag | Add an entry to `data/tags.json` + a matching checkbox in `report-release.yml`. |
| Rename a tag | Change `label` in `data/tags.json` + update the checkbox text in `report-release.yml`. |
| Remove a tag | Set `active: false` in `data/tags.json` + remove the checkbox from `report-release.yml`. |
| Merge two tags | Run the "Merge tags" GitHub Action with the two tag ids. |

## Project structure

```
index.html                                  the calendar itself
submit.html                                  lightweight submission form
merge.py                                     merges approved releases into the monthly data files
sync_issues.py                               syncs approved GitHub Issues into the merge pipeline
guard_labels.py                              reverts "approved" mistakenly applied outside [Release] issues
guard_title.py                               restores the "[Release]"/"[Correction]" title prefix if removed
data/                                        monthly release data (YYYY-MM.json)
data/tags.json                               single source of truth for tag ids/labels
tools/check_tags_sync.py                     fails CI if the issue template and tags.json disagree
tools/merge_tags.py                          merges two existing tags into one (run manually)
vercel/                                      Vercel serverless function powering submit.html
worker/                                      Cloudflare Worker alternative to the Vercel function
.github/ISSUE_TEMPLATE/report-release.yml    "Submit a release" issue template
.github/ISSUE_TEMPLATE/report-correction.yml "Report a correction" issue template
.github/workflows/sync.yml                   sync + label/title guard workflows
.github/workflows/check-tags.yml             checks tags.json vs. the issue template on every change
.github/workflows/merge-tags.yml             manually-triggered tag merge
```
