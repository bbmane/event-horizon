# Deploy della function "submit release" su Vercel

Il sito (`index.html` / `submit.html`) resta su GitHub Pages. Solo questa
cartella `vercel/` diventa un progetto Vercel a parte, che espone
`https://<tuo-progetto>.vercel.app/api/submit`.

## 1. Crea il PAT GitHub (permessi minimi)
GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token
- Repository access: **Only select repositories** → `event-horizon`
- Permissions → **Issues: Read and write**
- Nient'altro.

## 2. Crea il progetto su Vercel
Due modi, scegli quello che preferisci:

**A) Da dashboard (più semplice):**
1. vercel.com → New Project → importa il repo GitHub
2. Alla richiesta di "Root Directory" seleziona `vercel/`
3. Deploy

**B) Da CLI:**
```
npm install -g vercel
cd vercel
vercel
```

## 3. Imposta le variabili d'ambiente
Nel progetto su vercel.com → Settings → Environment Variables, aggiungi:
- `GITHUB_TOKEN` → il PAT creato al punto 1 (segnalo come "Secret")
- `GITHUB_OWNER` → `bbmane`
- `GITHUB_REPO` → `event-horizon`
- `ALLOWED_ORIGIN` → `https://bbmane.github.io` (l'origine esatta da cui servi il sito, senza slash finale)

Dopo averle aggiunte, fai un redeploy (Settings → Deployments → "..." → Redeploy)
perché le env var vengano applicate.

## 4. Collega il form alla function
In `submit.html`, riga con `WORKER_URL`, sostituisci con:
```
https://<tuo-progetto>.vercel.app/api/submit
```

## Test
```
curl -X POST https://<tuo-progetto>.vercel.app/api/submit \
  -H "Content-Type: application/json" \
  -H "Origin: https://bbmane.github.io" \
  -d '{"title":"Test Release","type":"Video Game","date":"2026-12-01","url":"https://example.com","image":"","tags":["Cyberpunk"]}'
```
Dovrebbe crearti una issue "[Release] Test Release" con label `pending` sul repo.

## Differenze rispetto alla versione Cloudflare
- Stessa identica logica di validazione e stesso formato dell'issue: nessuna
  modifica a `sync_issues.py` / `merge.py`.
- Le env var si impostano dal dashboard invece che con `wrangler secret put`.
- Il piano gratuito di Vercel ha limiti di invocazioni/banda generosi, più
  che sufficienti per un form di submission come questo.

## Nota anti-spam
Vale lo stesso discorso di prima: honeypot già incluso; se serve di più,
Vercel non ha un rate limiting integrato gratuito paragonabile a quello di
Cloudflare — l'opzione più semplice da aggiungere in futuro resta
**Cloudflare Turnstile** (captcha invisibile), verificato lato function.
