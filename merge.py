"""
Gestisce il salvataggio degli eventi nei file mensili data/YYYY-MM.json,
facendo merge per ID (aggiorna se esiste, aggiunge se nuovo) invece di
sovrascrivere - così una issue corretta/riaperta aggiorna l'evento
esistente invece di duplicarlo.
"""
import glob
import json
import os
from collections import defaultdict

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def _month_file(year_month: str) -> str:
    return os.path.join(DATA_DIR, f"{year_month}.json")


def _load_month(year_month: str) -> dict:
    path = _month_file(year_month)
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        events = json.load(f)
    return {e["id"]: e for e in events}


def _save_month(year_month: str, events_by_id: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    events = sorted(events_by_id.values(), key=lambda e: e["date"])
    with open(_month_file(year_month), "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)


def _all_month_keys() -> list[str]:
    """Es. ['2026-09', '2026-10', ...] ricavati dai file già presenti in /data."""
    return [
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(DATA_DIR, "*.json"))
    ]


def _find_existing_month(event_id: str, skip_month: str) -> str | None:
    """Cerca in quale altro file mensile (diverso da skip_month) esiste già
    questo id - capita quando una issue riaperta cambia la release date
    facendola cadere in un mese diverso da quello in cui era stata
    originariamente sincronizzata."""
    for year_month in _all_month_keys():
        if year_month == skip_month:
            continue
        if event_id in _load_month(year_month):
            return year_month
    return None


def merge_events(all_events: list[dict]) -> dict:
    """Raggruppa gli eventi per mese (YYYY-MM ricavato da 'date') e fa
    merge con quanto già presente su disco. Se un id esisteva già in un
    mese diverso (cambio di release date che sposta l'evento in un altro
    file), lo rimuove da lì per evitare duplicati. Ritorna
    {mese: (nuovi, aggiornati)}."""
    by_month = defaultdict(list)
    for event in all_events:
        year_month = event["date"][:7]
        by_month[year_month].append(event)

    summary = {}
    moved = []
    for year_month, events in by_month.items():
        existing = _load_month(year_month)
        nuovi, aggiornati = 0, 0
        for event in events:
            old_month = _find_existing_month(event["id"], skip_month=year_month)
            if old_month:
                old_events = _load_month(old_month)
                del old_events[event["id"]]
                _save_month(old_month, old_events)
                moved.append((event["id"], old_month, year_month))

            if event["id"] in existing:
                if existing[event["id"]] != event:
                    aggiornati += 1
            else:
                nuovi += 1
            existing[event["id"]] = event
        _save_month(year_month, existing)
        summary[year_month] = (nuovi, aggiornati)

    for event_id, old_month, new_month in moved:
        print(f"  Moved {event_id}: {old_month} -> {new_month}")

    return summary
