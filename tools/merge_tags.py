"""
Unisce due tag esistenti: sostituisce ogni occorrenza di `old_id` con
`new_id` in tutti i data/YYYY-MM.json (deduplicando se una release avesse
già entrambi), poi marca `old_id` come inattivo in data/tags.json,
puntandolo a `new_id` per riferimento.

Pensato per girare raramente e deliberatamente - solo quando due tag si
scopre che si sovrappongono e vanno unificati in uno - mai in automatico.
Lanciarlo tramite la GitHub Action "Merge tags" (workflow_dispatch),
passando old_id e new_id come input, e controllare il diff del commit
risultante prima che finisca su main.

Per una semplice rinomina o rimozione di un tag NON serve questo script:
basta modificare "label" (rinomina) o "active": false (rimozione)
direttamente in data/tags.json - le release vecchie, salvando solo l'id,
si aggiornano da sole.

Uso: python tools/merge_tags.py <old_id> <new_id>
"""
import glob
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA_DIR = os.path.join(ROOT, "data")
TAGS_FILE = os.path.join(DATA_DIR, "tags.json")


def _load_tags() -> list[dict]:
    with open(TAGS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_tags(tags: list[dict]):
    with open(TAGS_FILE, "w", encoding="utf-8") as f:
        json.dump(tags, f, indent=2, ensure_ascii=False)
        f.write("\n")


def merge_tags(old_id: int, new_id: int):
    tags = _load_tags()
    ids = {t["id"] for t in tags}
    if old_id not in ids or new_id not in ids:
        print(f"Both {old_id} and {new_id} must exist in data/tags.json.")
        sys.exit(1)
    if old_id == new_id:
        print("old_id and new_id are the same, nothing to do.")
        sys.exit(1)

    changed_files = 0
    changed_events = 0
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "*.json"))):
        with open(path, "r", encoding="utf-8") as f:
            events = json.load(f)

        file_changed = False
        for event in events:
            event_tags = event.get("tags", [])
            if old_id not in event_tags:
                continue
            merged = sorted({new_id if t == old_id else t for t in event_tags})
            if merged != sorted(event_tags):
                event["tags"] = merged
                file_changed = True
                changed_events += 1

        if file_changed:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(events, f, indent=2, ensure_ascii=False)
                f.write("\n")
            changed_files += 1
            print(f"  updated {os.path.basename(path)}")

    for t in tags:
        if t["id"] == old_id:
            t["active"] = False
            t["merged_into"] = new_id
    _save_tags(tags)

    print(f"Done: {changed_events} event(s) across {changed_files} file(s) moved from tag {old_id} to {new_id}.")
    print(f"Tag {old_id} marked inactive in data/tags.json (merged_into: {new_id}).")
    print("Remember to remove its checkbox from .github/ISSUE_TEMPLATE/report-release.yml too.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python tools/merge_tags.py <old_id> <new_id>")
        sys.exit(1)
    merge_tags(int(sys.argv[1]), int(sys.argv[2]))
