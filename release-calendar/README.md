# releases.log

Calendario di uscite sci-fi/cyberpunk (film, serie, anime, giochi, manga),
curato dalle segnalazioni delle persone invece che da un aggregatore
automatico multi-fonte. Nessun server, nessun database: i dati vivono
come file JSON nel repo, un frontend statico in stile terminale li mostra.

## Come funziona

1. Chiunque apre una **Issue** su questo repo usando il template
   "Report a release" (tab *Issues* → *New issue*)
2. Un maintainer la rivede: se ha senso, ci aggiunge la label `approved`
3. Una GitHub Action legge in automatico le issue `approved`, le
   trasforma in un evento JSON, le committa in `data/YYYY-MM.json`,
   e chiude la issue con un commento di conferma
4. Il sito (`index.html`, servito via GitHub Pages) mostra il
   calendario mese per mese leggendo quei JSON

Se una issue ha una data non valida o campi mancanti, viene etichettata
`needs-fix` invece di essere processata, con un commento che spiega
cosa correggere - basta editarla e rimettere la label `approved`.

## Cosa sono le Issue, se non le hai mai usate

Sono la bacheca "segnalazioni" di ogni repo GitHub: tab **Issues** in
alto. Aprirne una è come scrivere un post - il template già pronto
(`.github/ISSUE_TEMPLATE/report-release.yml`) mostra un modulo con
campi precompilati (tipo, data, link, perché è cyberpunk) invece di un
box di testo libero, così è facile da processare in automatico.

## Setup

```bash
pip install requests
```

Su GitHub:
1. Settings → Pages → Source: "Deploy from branch" → `main`, `/ (root)`
2. Il workflow `.github/workflows/sync.yml` gira già da solo: ad ogni
   label aggiunta su una issue, una volta al giorno come rete di
   sicurezza, o a mano dalla tab Actions
3. Non serve creare nessun secret: lo script usa `GITHUB_TOKEN`,
   fornito automaticamente da GitHub Actions ad ogni run

## Schema evento

```json
{
  "id": "issue-42",
  "type": "game",
  "title": "...",
  "date": "2026-11-15",
  "genres": ["Sci-Fi"],
  "matched_keywords": [],
  "source_url": "...",
  "note": "perché è cyberpunk, dalla issue originale",
  "image_url": "... (opzionale)"
}
```

`id` traccia il numero della issue di origine, così ogni evento è
sempre riconducibile a chi l'ha segnalato e alla discussione originale.

## Struttura

```
sync_issues.py              ← legge le issue approved, le trasforma in eventi
merge.py                    ← merge incrementale per ID nei file mensili
data/YYYY-MM.json           ← output, un file per mese
index.html                  ← frontend statico, stile terminale/CRT ambra
.github/ISSUE_TEMPLATE/
  report-release.yml         ← modulo di segnalazione
.github/workflows/
  sync.yml                   ← automazione
```

## Prossimi passi possibili

- Decidere se aprire i permessi di `approved` anche ad altri (oggi:
  solo maintainer del repo)
- Mostrare il campo `note` nell'interfaccia (oggi il frontend lo ignora)
- Aggiungere URL routing per mese (`#2026-11`)
