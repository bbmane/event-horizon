"""
Gestisce il salvataggio degli eventi nei file mensili data/YYYY-MM.json,
facendo merge per ID (aggiorna se esiste, aggiunge se nuovo) invece di
sovrascrivere - così una issue corretta/riaperta aggiorna l'evento
esistente invece di duplicarlo.
"""
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


def merge_events(all_events: list[dict]) -> dict:
    """Raggruppa gli eventi per mese (YYYY-MM ricavato da 'date') e fa
    merge con quanto già presente su disco. Ritorna {mese: (nuovi, aggiornati)}."""
    by_month = defaultdict(list)
    for event in all_events:
        year_month = event["date"][:7]
        by_month[year_month].append(event)

    summary = {}
    for year_month, events in by_month.items():
        existing = _load_month(year_month)
        nuovi, aggiornati = 0, 0
        for event in events:
            if event["id"] in existing:
                if existing[event["id"]] != event:
                    aggiornati += 1
            else:
                nuovi += 1
            existing[event["id"]] = event
        _save_month(year_month, existing)
        summary[year_month] = (nuovi, aggiornati)

    return summary
