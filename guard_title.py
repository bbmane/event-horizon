"""
Guardrail triggered when an issue is opened or edited, to restore the
"[Release] " / "[Correction] " title prefix if it's missing — either
because a submitter deleted it thinking it's a placeholder to remove
(Issue Forms only pre-fill the title field, they don't lock it), or
because it was edited out later.

sync_issues.py and guard_labels.py both identify issue type from this
prefix, so a missing prefix makes an otherwise valid issue invisible
to (or misclassified by) both.

Meant to run as a step in .github/workflows/sync.yml, triggered on the
`issues: opened` and `issues: edited` events. Uses the label GitHub
applies automatically at creation from the template itself ("pending"
-> report-release.yml, "correction" -> report-correction.yml) to know
which prefix is expected, since that label isn't something the
submitter can remove.
"""
import json
import os

import requests

GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
REPO = os.environ["GITHUB_REPOSITORY"]
API_BASE = f"https://api.github.com/repos/{REPO}"

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
}

PREFIX_BY_LABEL = {
    "pending": "[Release]",
    "correction": "[Correction]",
}


def main():
    event_path = os.environ["GITHUB_EVENT_PATH"]
    with open(event_path, "r", encoding="utf-8") as f:
        event = json.load(f)

    # On "edited", only act when the title itself changed — an edit to the
    # body/labels also fires this event, and we don't need to re-check the
    # title on every one of those.
    if event.get("action") == "edited" and "title" not in (event.get("changes") or {}):
        return

    issue = event["issue"]
    number = issue["number"]
    title = issue.get("title") or ""
    label_names = {l["name"] for l in issue.get("labels", [])}

    expected_prefix = next(
        (prefix for label, prefix in PREFIX_BY_LABEL.items() if label in label_names),
        None,
    )
    if not expected_prefix or title.startswith(expected_prefix):
        return  # not our business, or prefix already present

    fixed_title = f"{expected_prefix} {title}".strip()
    print(f"issue #{number}: missing '{expected_prefix}' prefix, restoring -> {fixed_title!r}")

    resp = requests.patch(
        f"{API_BASE}/issues/{number}",
        headers=HEADERS, json={"title": fixed_title}, timeout=15,
    )
    if not resp.ok:
        print(f"  ⚠️ failed to fix title: HTTP {resp.status_code}: {resp.text[:200]}")
        return

    requests.post(
        f"{API_BASE}/issues/{number}/comments",
        headers=HEADERS,
        json={"body": (
            f"ℹ️ I restored the `{expected_prefix}` prefix on the title — it's not a "
            "placeholder to delete, it's how the sync pipeline recognizes this "
            "submission type. The rest of your title is untouched."
        )},
        timeout=15,
    )


if __name__ == "__main__":
    main()
