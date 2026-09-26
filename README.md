# Event Horizon

[![Code License: AGPL v3](https://img.shields.io/badge/code%20license-AGPL%20v3-blue.svg)](LICENSE)
[![Data License: CC BY-NC-ND 4.0](https://img.shields.io/badge/data%20license-CC%20BY--NC--ND%204.0-lightgrey.svg)](data/LICENSE)

A community-curated calendar for sci-fi and cyberpunk releases. Keep track of upcoming movies, series, anime, games and more.

🤖 [Explore Event Horizon](https://bbmane.github.io/event-horizon/)

## What is this?

`Event Horizon` is a shared space for enthusiasts to discover upcoming sci-fi and cyberpunk media. Whether it's a new dystopian game, a cyberpunk anime, or a hard sci-fi book adaptation, this calendar helps you stay up to date.

Filters by type and tags help you showing specific medias and tropes you're looking for, while also allowing you to discover new ones.

<p align="left">
  <img src="https://i.imgur.com/fqCAJ2i.gif" width="70%">
</p>

## How to Contribute

Found a sci-fi or cyberpunk release that's missing? Adding it to the calendar takes less than a minute — **no GitHub account required**. You can submit anonymously through the [submission form](https://bbmane.github.io/event-horizon/submit.html): nothing about you is stored, no login, no email, no account of any kind.

1. Head over to the **[Submit a Release](https://bbmane.github.io/event-horizon/submit.html)** page.
2. Fill in the title, release date, a link for verification, and select the core sci-fi themes that fit the work.
3. Once approved, it automatically appears on the calendar!

Prefer using your own GitHub account instead? You can open the **[Submit a Release](https://github.com/bbmane/event-horizon/issues/new?template=report-release.yml)** issue directly — same result, but it lets you follow up on your own submission (answer a moderator's questions, edit it, track its status) rather than submitting and forgetting it.

Spotted a mistake on an entry that's already on the calendar (dead link, wrong date, wrong tags)? Use **[Report a Correction](https://github.com/bbmane/event-horizon/issues/new?template=report-correction.yml)** instead — this one does require a GitHub account, since a moderator needs to reopen the original issue and reference your report while fixing it.

Not sure whether something counts as a new release — a remaster, a new season, which date to use for a manga or series? Check the **[Submission Guidelines](https://github.com/bbmane/event-horizon/wiki/Submission-Guidelines)** wiki page before you submit.

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
guard_title.py                               restores the "[Release]"/"[Correction]" title prefix if removed
data/                                        monthly release data (YYYY-MM.json)
vercel/                                      Vercel serverless function powering submit.html
.github/ISSUE_TEMPLATE/report-release.yml    "Submit a release" issue template
.github/ISSUE_TEMPLATE/report-correction.yml "Report a correction" issue template
.github/workflows/sync.yml                   sync + label guard workflows
```

## License

Code here is open — fork it, remix it, run your own version ([LICENSE](LICENSE)) but keep it open. <br>
`/data`, though, is under [CC LICENSE](data/LICENSE): rebuild your own dataset, don't copy-paste ours.

##

<sub>Star this repo if you like the project :)</sub>
