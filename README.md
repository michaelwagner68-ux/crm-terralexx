# Terralexx CRM

Webbasiertes Vertriebstool für Terralexx, AS Bildungsakademie und Aurin.
Kontakte, Verkaufschancen, Wiedervorlagen, Dokumente und Auswertung –
mit Netlify Database als Datenhaltung.

## Aufbau

```
public/index.html                     Anwendung (React 18, kein Build nötig)
netlify/functions/api.js              Serverfunktion, bedient /api/*
netlify/db/migrations/0001_init.sql   Datenbankschema
netlify.toml                          Netlify-Konfiguration
apitest.js                            32 Tests gegen ein echtes Postgres
devserver.js                          lokaler Testserver
```

## Einrichtung

Siehe [EINRICHTUNG.md](EINRICHTUNG.md) – Datenbank anlegen, deployen,
Administrator einrichten.

## Kurzfassung

1. Repository in Netlify mit dem Projekt `terralexx-crm-app` verbinden
   (Build command leer, Publish directory `public`)
2. Im Projekt: Database → Add database
3. Deploy abwarten, dann einmalig den Administrator anlegen:

```bash
curl -X POST https://terralexx-crm-app.netlify.app/api/setup \
  -H "content-type: application/json" \
  -d '{"login":"admin.wagner","pass":"DEIN-PASSWORT","name":"Michael Wagner"}'
```

## Tests

```bash
npm install
node apitest.js        # benötigt DATABASE_URL auf ein Postgres
```
