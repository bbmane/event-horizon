# Event Horizon

[![Code License: AGPL v3](https://img.shields.io/badge/code%20license-AGPL%20v3-blue.svg)](LICENSE)
[![Data License: CC BY-NC-ND 4.0](https://img.shields.io/badge/data%20license-CC%20BY--NC--ND%204.0-lightgrey.svg)](data/LICENSE)

A community-curated calendar for sci-fi and cyberpunk releases. Keep track of upcoming movies, series, anime, games, manga, and albums.

🤖 [Explore Event Horizon](https://bbmane.github.io/event-horizon/)

## What is this?

`Event Horizon` is a shared space for enthusiasts to collect and discover upcoming sci-fi and cyberpunk media. Whether it's a new dystopian game, a cyberpunk anime, or a hard sci-fi book adaptation, this calendar helps you stay up to date.

The entire schedule is built and maintained directly by the community.

## How to Contribute

Found a sci-fi or cyberpunk release that's missing? Adding it to the calendar takes less than a minute:

1. Head over to the **[Submit a Release](https://github.com/bbmane/event-horizon/issues/new?template=report-release.yml)** page.
2. Fill in the title, release date, a link for verification, and select the core sci-fi themes that fit the work.
3. Once approved, it automatically appears on the calendar!

Spotted a mistake on an entry that's already on the calendar (dead link, wrong date, wrong tags)? Use **[Report a Correction](https://github.com/bbmane/event-horizon/issues/new?template=report-correction.yml)** instead — a moderator will pick it up and fix the original entry.

## How it works

- Submissions come in as GitHub Issues, either via the template above or through `submit.html`, which posts to a small serverless function (`vercel/api/submit.js`) that opens the issue on your behalf — no GitHub account needed.
- Once a moderator approves an issue, an automated workflow (`sync_issues.py` + `merge.py`) folds it into the monthly release files under `/data`.
- Corrections go through a separate template and are not auto-processed: a moderator reopens the original `[Release]` issue, fixes the data there, and re-approves it, so the correction flows through the same sync pipeline.
- A guard job (`guard_labels.py`) watches for the `approved` label being applied to anything that isn't a `[Release]` issue, and reverts it with an explanatory comment — this keeps the sync pipeline from choking on issues it can't parse.
- `index.html` reads the monthly files directly and renders the calendar — no backend, no database, just static JSON served through GitHub Pages.

## Project structure

```
index.html                                  the calendar itself
submit.html                                  lightweight submission form
merge.py                                     merges approved releases into the monthly data files
sync_issues.py                               syncs approved GitHub Issues into the merge pipeline
guard_labels.py                              reverts "approved" mistakenly applied outside [Release] issues
data/                                        monthly release data (YYYY-MM.json)
vercel/                                      Vercel serverless function powering submit.html
.github/ISSUE_TEMPLATE/report-release.yml    "Submit a release" issue template
.github/ISSUE_TEMPLATE/report-correction.yml "Report a correction" issue template
.github/workflows/sync.yml                   sync + label guard workflows
```

## License

Code here is open — fork it, remix it, run your own version ([AGPLv3 LICENSE](LICENSE)). <br>
`/data`, though, is under [CC BY-NC-ND 4.0 LICENSE](data/LICENSE): rebuild your own dataset, don't copy-paste ours.

##

<sub>Star this repo if you like the project :)</sub>
