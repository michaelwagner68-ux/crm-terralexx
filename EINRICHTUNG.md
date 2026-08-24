# Terralexx CRM mit Datenbank – Einrichtung auf Netlify

Diese Fassung legt die Daten in einer echten Datenbank ab statt im Browser.
Damit arbeiten alle Benutzer auf demselben Bestand, Passwörter liegen nur
noch als Hash auf dem Server, und die Mandantentrennung wird serverseitig
durchgesetzt – nicht mehr nur in der Oberfläche.

## Warum Netlify Database

Dein Team „AI Team" ist auf dem Pro-Tarif, und Pro ist kreditbasiert. Damit
ist Netlify Database verfügbar. Sie liegt im selben Konto wie das Projekt,
bringt die Migrationen mit und braucht keinen zweiten Anbieter.

Zur Einordnung für deine Kundengespräche: Netlify Database läuft technisch auf
Neon. Wenn EU-Datenhaltung ein Argument gegenüber deinen Mandanten ist, prüfe
beim Anlegen die Region – oder wähle Supabase mit Frankfurt-Region. Der
Serverteil ist bewusst so geschrieben, dass ein Wechsel nur den
Verbindungsaufbau in `netlify/functions/api.js` betrifft.

## Aufbau

```
public/index.html                     Die Anwendung (unverändert einsetzbar)
netlify/functions/api.js              Serverfunktion, bedient /api/*
netlify/db/migrations/0001_init.sql   Datenbankschema
netlify.toml                          Konfiguration
package.json                          Abhängigkeit @netlify/neon
```

Die Anwendung erkennt beim Start selbst, ob ein Server vorhanden ist. Ist
keiner erreichbar – etwa weil die Datei lokal geöffnet wurde – arbeitet sie
wie bisher mit dem Browserspeicher weiter. Es gibt also weiterhin nur eine
`index.html`, die in beiden Welten funktioniert.

## Schritt für Schritt

**1. Projektdateien nach Git**

Ein Repository anlegen und diesen Ordner einchecken. Der Weg über Git ist
hier nötig, weil Netlify die Migrationen aus dem Repository liest.

**2. Repository mit dem Projekt verbinden**

In Netlify beim Projekt `terralexx-crm-app` unter Project configuration →
Build & deploy → Continuous deployment das Repository verknüpfen.
Build command bleibt leer, Publish directory ist `public`.

**3. Datenbank anlegen**

Im Projekt auf Database → Add database. Netlify legt die Datenbank an und
hinterlegt `NETLIFY_DATABASE_URL` automatisch als Umgebungsvariable. Beim
nächsten Deploy laufen die Migrationen aus `netlify/db/migrations` von selbst.

Alternativ über die Kommandozeile:

```
npx netlify-cli link
npx netlify-cli db init
npx netlify-cli deploy --prod
```

**4. Administrator anlegen**

Nach dem ersten Deploy ist die Datenbank leer. Einmalig aufrufen:

```
curl -X POST https://terralexx-crm-app.netlify.app/api/setup \
  -H "content-type: application/json" \
  -d '{"login":"admin.wagner","pass":"DEIN-PASSWORT","name":"Michael Wagner"}'
```

Der Endpunkt funktioniert nur, solange es keinen einzigen Benutzer gibt –
danach antwortet er mit einer Fehlermeldung. Das Passwort braucht mindestens
zehn Zeichen und taucht nirgends im Quelltext auf.

**5. Anmelden und einrichten**

Auf der Seite anmelden. Der Kasten „Erste Schritte" führt durch Benutzeranlage,
Mandanten und Import. Mandanten, Phasen, Kanäle und Vorlagen sind in der
leeren Datenbank noch nicht angelegt – beim ersten Speichern in den
Einstellungen werden sie geschrieben.

**6. Zusätzlich absichern**

Auch mit Datenbank empfiehlt sich der Netlify-Passwortschutz für das Projekt,
solange keine echte Zwei-Faktor-Anmeldung eingebaut ist:
Site configuration → Access control → Password protection.

## Was der Server durchsetzt

Diese Regeln greifen serverseitig; ein manipulierter Browser kommt nicht daran
vorbei. Alle Punkte sind mit automatischen Tests gegen ein echtes Postgres
abgesichert (`node apitest.js`, 30 Prüfungen):

- Ohne gültige Sitzung liefert die API keine Daten
- Passwörter liegen als PBKDF2-SHA512 mit 210.000 Runden und eigenem Salz vor
- Der Vergleich läuft in konstanter Zeit, auch für unbekannte Benutzernamen
- Ein Vertriebsbenutzer erhält nur Kontakte seiner Mandanten und nur eigene
- Schreibversuche in fremde Mandanten werden abgelehnt und protokolliert
- Nur Super-Admins dürfen Benutzer und Konfiguration ändern
- Wird ein Benutzer gesperrt, enden seine offenen Sitzungen sofort
- Dokumente prüfen den Mandanten des zugehörigen Kontakts vor der Herausgabe
- Sitzungen laufen nach sieben Tagen ab, abgelaufene werden aufgeräumt

## Datenbestand aus der Browserfassung übernehmen

In der bisherigen Fassung unter Einstellungen → Daten & Betrieb auf
„Daten sichern" klicken. Die JSON-Datei enthält alles. In der Datenbankfassung
lassen sich Kontakte über den normalen Import einlesen; für Chancen und
Aktivitäten sage mir Bescheid, dann schreibe ich ein kleines Einspielskript.

## Laufende Kosten

Datenbankspeicher ist bis zum 1. Juli 2026 kostenfrei, danach zählt er auf die
Kredite. Rechenzeit und Datenverkehr verbrauchen Kredite; im Pro-Tarif sind
3.000 im Monat enthalten, erweiterbar in Stufen. Für vier Benutzer und einige
tausend Datensätze bleibt das im Rahmen. Wichtig: **Ausgabenlimit setzen**
unter Team → Billing, damit es keine Überraschungen gibt.

## Betrieb

- Sicherung: Netlify Database bringt Backup und Wiederherstellung mit
  (Database → Backup and recovery)
- Vorschau-Deploys bekommen automatisch eine eigene Datenbankkopie, produktive
  Daten bleiben davon unberührt
- Das Protokoll liegt in der Tabelle `audit` und hält Anmeldungen und
  Änderungen fest
