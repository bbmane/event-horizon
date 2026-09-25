"""
Guardrail triggered when the "approved" label is added to an issue.

sync_issues.py only knows how to process issues created from the
"Report a release" template (title starting with "[Release]"). If someone
mistakenly adds "approved" to any other issue (e.g. a [Correction] report),
this removes the label right away and explains why, instead of letting it
sit until the next scheduled sync silently fails on it.

Meant to run as a step in .github/workflows/sync.yml, triggered on the
`issues: labeled` event. Reads which label was added and which issue from
the GITHUB_EVENT_PATH payload GitHub Actions provides automatically.
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

WARNING = (
    "⚠️ The `approved` label was removed: this issue isn't a `[Release]` "
    "submission, so it won't be processed by the sync workflow. If you "
    "meant to approve a correction, please apply the fix on the original "
    "`[Release]` issue instead."
)


def main():
    event_path = os.environ["GITHUB_EVENT_PATH"]
    with open(event_path, "r", encoding="utf-8") as f:
        event = json.load(f)

    label_name = (event.get("label") or {}).get("name", "")
    if label_name != "approved":
        return  # not our business, some other label was added

    issue = event["issue"]
    number = issue["number"]
    title = issue.get("title") or ""

    if title.startswith("[Release]"):
        return  # legit, let sync_issues.py handle it

    print(f"issue #{number}: 'approved' added to a non-[Release] issue, reverting.")

    resp = requests.delete(
        f"{API_BASE}/issues/{number}/labels/approved",
        headers=HEADERS, timeout=15,
    )
    if not resp.ok and resp.status_code != 404:
        print(f"  ⚠️ failed to remove label: HTTP {resp.status_code}: {resp.text[:200]}")

    resp = requests.post(
        f"{API_BASE}/issues/{number}/comments",
        headers=HEADERS, json={"body": WARNING}, timeout=15,
    )
    if not resp.ok:
        print(f"  ⚠️ failed to post comment: HTTP {resp.status_code}: {resp.text[:200]}")


if __name__ == "__main__":
    main()
