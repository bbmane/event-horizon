"""
Fallisce se le checkbox del template "Submit a release"
(.github/ISSUE_TEMPLATE/report-release.yml) non corrispondono ai tag
attivi elencati in data/tags.json.

Le GitHub Issue Forms sono YAML statico - non possono leggere tags.json
a runtime - quindi ogni volta che un tag viene aggiunto, rinominato o
ritirato, questo file va aggiornato a mano. Questo script serve a
scoprire subito un aggiornamento mancato (in CI), invece che settimane
dopo, quando qualcuno nota un tag nel form che non corrisponde più a
nessun tag conosciuto, o un tag in tags.json che non è più selezionabile
dal form.

Uso manuale: python tools/check_tags_sync.py
Gira automaticamente nel workflow "Check tags sync" ogni volta che
data/tags.json o il template vengono modificati.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
TAGS_FILE = os.path.join(ROOT, "data", "tags.json")
TEMPLATE_FILE = os.path.join(ROOT, ".github", "ISSUE_TEMPLATE", "report-release.yml")


def _active_tag_labels() -> set[str]:
    with open(TAGS_FILE, "r", encoding="utf-8") as f:
        tags = json.load(f)
    return {t["label"] for t in tags if t.get("active", True)}


def _template_tag_labels() -> set[str]:
    with open(TEMPLATE_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    # Isola il blocco delle checkbox dei tag (dall'id "tags" al prossimo "- type:")
    match = re.search(r"id: tags\b.*?(?=\n  - type:|\Z)", content, re.S)
    if not match:
        print("Could not find the 'tags' checkboxes block in the template.")
        sys.exit(1)

    block = match.group(0)
    return set(re.findall(r'- label:\s*"([^"]+)"', block))


def main():
    active = _active_tag_labels()
    template = _template_tag_labels()

    missing_from_template = active - template
    extra_in_template = template - active

    if not missing_from_template and not extra_in_template:
        print(f"OK: {len(active)} active tags match the template exactly.")
        return

    if missing_from_template:
        print("Active in data/tags.json but MISSING from the template:")
        for label in sorted(missing_from_template):
            print(f"  - {label}")
    if extra_in_template:
        print("In the template but not an active tag in data/tags.json:")
        for label in sorted(extra_in_template):
            print(f"  - {label}")

    sys.exit(1)


if __name__ == "__main__":
    main()
