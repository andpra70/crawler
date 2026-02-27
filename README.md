# Site Image Crawler + Web UI

Crawler Node.js che:
- scarica immagini da sito/Pinterest con filtri (`min-width`, `q` qualità)
- salva in `data/site/images/` con nome `hash-WxH-nome.ext`
- logga attività in `data/site/activity.log`
- espone una UI React (Vite) per lanciare il crawl e sfogliare le immagini

## Requisiti
- Node.js 18+

## Installazione
```bash
npm install
```

## Avvio Web App (porta 6064)
```bash
npm run dev
```

Questo avvia:
- API server su `http://localhost:6065`
- Vite React UI su `http://localhost:6064`

La UI su `6064` consente di:
- impostare parametri ricerca/opzioni crawl
- avviare la ricerca
- vedere stato/report/log
- browse immagini scaricate direttamente dal browser

## API principali
- `POST /api/crawl/start` avvia un crawl
- `GET /api/crawl/status` stato processo
- `GET /api/report` report JSON
- `GET /api/logs?lines=250` ultime righe log
- `GET /api/images` lista immagini
- `GET /images/:name` file immagine statico

## CLI diretta (opzionale)
```bash
node src/crawler.js --mode pinterest --query "travel photography" --max-images 80 --min-width 300 --q 70
```

## Parametri crawler
- `--mode` `site|pinterest` (default `site`)
- `--url` URL iniziale
- `--query` query Pinterest
- `--depth` profondità crawl site (default `2`)
- `--min-width` larghezza minima (default `200`)
- `--q`/`--quality` qualità ricompressione 1-100 (default `75`)
- `--cookie` cookie iniziali (`a=b; c=d`)
- `--same-origin` `true|false` (site mode)
- `--max-images` massimo immagini pinterest (default `120`)
- `--max-scrolls` massimo scroll pinterest (default `50`)
- `--headful` `true|false` browser visibile (default `false`)
