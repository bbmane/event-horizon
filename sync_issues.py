"""
Legge le Issue con label "approved" dal repo (create tramite il template
"Report a release"), le trasforma in eventi nello schema JSON del
calendario e le aggiunge a data/YYYY-MM.json.

Pensato per girare via GitHub Actions: usa il GITHUB_TOKEN automatico
(nessun secret da configurare a mano) e GITHUB_REPOSITORY per sapere
owner/repo senza bisogno di hardcodarli.

Dopo il merge, ogni issue processata con successo:
  - riceve un commento di conferma con il periodo in cui è stata inserita
  - viene chiusa e rietichettata "synced" (così non viene riprocessata)
Le issue con una data non valida vengono invece etichettate "needs-fix"
e lasciate aperte, con un commento che spiega cosa correggere.
"""
import os
import re
import sys
from datetime import date

import requests

from merge import merge_events

GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
REPO = os.environ["GITHUB_REPOSITORY"]  # "owner/repo", fornito da Actions
API_BASE = f"https://api.github.com/repos/{REPO}"

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
}

TYPE_MAP = {
    "movie": "movie",
    "tv series": "series",
    "anime": "anime",
    "video game": "game",
    "manga": "manga",
    "album": "album",
}


def _fetch_approved_issues() -> list[dict]:
    issues, page = [], 1
    while True:
        resp = requests.get(
            f"{API_BASE}/issues",
            headers=HEADERS,
            params={"labels": "approved", "state": "open", "per_page": 100, "page": page},
            timeout=15,
        )
        resp.raise_for_status()
        batch = resp.json()
        issues.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return issues


def _parse_form_body(body: str) -> dict:
    """Le Issue Form generano un body tipo:
        ### Type
        Video Game

        ### Release date
        2026-11-15
    Questo estrae {label_lowercase: valore}."""
    fields = {}
    for match in re.finditer(r"### (.+?)\n+(.+?)(?=\n### |\Z)", body, re.S):
        label = match.group(1).strip().lower()
        value = match.group(2).strip()
        if value == "_No response_":
            value = ""
        fields[label] = value
    return fields


def _clean_title(raw_title: str) -> str:
    return re.sub(r"^\[Release\]\s*", "", raw_title).strip()


def _comment(issue_number: int, body: str):
    requests.post(
        f"{API_BASE}/issues/{issue_number}/comments",
        headers=HEADERS, json={"body": body}, timeout=15,
    )


def _close_and_relabel(issue_number: int, add: str, remove: str):
    requests.post(
        f"{API_BASE}/issues/{issue_number}/labels",
        headers=HEADERS, json={"labels": [add]}, timeout=15,
    )
    requests.delete(
        f"{API_BASE}/issues/{issue_number}/labels/{remove}",
        headers=HEADERS, timeout=15,
    )
    requests.patch(
        f"{API_BASE}/issues/{issue_number}",
        headers=HEADERS, json={"state": "closed"}, timeout=15,
    )


def _flag_needs_fix(issue_number: int, reason: str):
    requests.post(
        f"{API_BASE}/issues/{issue_number}/labels",
        headers=HEADERS, json={"labels": ["needs-fix"]}, timeout=15,
    )
    requests.delete(
        f"{API_BASE}/issues/{issue_number}/labels/approved",
        headers=HEADERS, timeout=15,
    )
    _comment(issue_number, f"⚠️ Couldn't process this: {reason}\nFix it and re-add the `approved` label.")


def main():
    issues = _fetch_approved_issues()
    print(f"Found {len(issues)} approved issue(s) to process.")

    events = []
    to_finalize = []  # (issue_number, year_month)

    for issue in issues:
        number = issue["number"]
        fields = _parse_form_body(issue.get("body") or "")

        raw_type = fields.get("type", "").strip().lower()
        event_type = TYPE_MAP.get(raw_type)
        if not event_type:
            _flag_needs_fix(number, f"unrecognized type '{raw_type}'.")
            continue

        date_str = fields.get("release date", "").strip()
        try:
            date.fromisoformat(date_str)
        except ValueError:
            _flag_needs_fix(number, f"'{date_str}' is not a valid YYYY-MM-DD date.")
            continue

        url = fields.get("source link", "").strip()
        if not url:
            _flag_needs_fix(number, "missing source link.")
            continue

        event = {
            "id": f"issue-{number}",
            "type": event_type,
            "title": _clean_title(issue["title"]),
            "date": date_str,
            "genres": ["Sci-Fi"],
            "matched_keywords": [],
            "source_url": url,
            "note": fields.get("why does this belong here?", "").strip(),
        }
        image = fields.get("cover / poster image url (optional)", "").strip()
        if image:
            event["image_url"] = image

        events.append(event)
        to_finalize.append((number, date_str[:7]))

    if events:
        summary = merge_events(events)
        for year_month, (nuovi, aggiornati) in sorted(summary.items()):
            print(f"  {year_month}: +{nuovi} new, {aggiornati} updated")

    for number, year_month in to_finalize:
        _close_and_relabel(number, add="synced", remove="approved")
        _comment(number, f"✅ Added to the calendar under **{year_month}**. Thanks for the report!")

    print("Done.")


if __name__ == "__main__":
    main()
