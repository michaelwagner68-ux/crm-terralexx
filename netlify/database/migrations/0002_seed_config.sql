-- =========================================================================
-- TERRALEXX CRM – Schema 2
--
-- Grundausstattung der Konfiguration. Die Anwendung braucht Mandanten,
-- Phasen, Kanaele und Vorlagen, um bedienbar zu sein: Ohne Mandanten laesst
-- sich kein Kontakt anlegen, weil jeder Kontakt einem Mandanten zugeordnet
-- sein muss.
--
-- In der Browserfassung entstanden diese Werte beim ersten Start aus
-- emptyDB(). Die Datenbankfassung startete dagegen vollstaendig leer, sodass
-- die Einstellungen nichts anzubieten hatten. Diese Migration holt das nach;
-- die Werte entsprechen exakt denen aus public/index.html.
--
-- ON CONFLICT DO NOTHING: Bereits vorhandene Konfiguration bleibt
-- unangetastet. Wer seine Mandanten schon selbst angelegt hat, verliert
-- nichts, und die Migration bleibt gefahrlos wiederholbar.
-- =========================================================================

INSERT INTO config (key, value) VALUES
  ('companies', $cfg$[
  {
    "id": "c_tx",
    "name": "Terralexx",
    "code": "T",
    "color": "#0B0B0C",
    "kinds": [
      "firmenkunde"
    ]
  },
  {
    "id": "c_as",
    "name": "AS Bildungsakademie",
    "code": "A",
    "color": "#3D5AA9",
    "kinds": [
      "firmenkunde",
      "schueler"
    ]
  },
  {
    "id": "c_au",
    "name": "Aurin",
    "code": "U",
    "color": "#7D95D2",
    "kinds": [
      "schueler"
    ]
  }
]$cfg$::jsonb),
  ('channels', $cfg$[
  {
    "id": "ch_goog",
    "name": "Google Ads",
    "gruppe": "Paid",
    "kosten": 0
  },
  {
    "id": "ch_meta",
    "name": "Meta / Instagram",
    "gruppe": "Paid",
    "kosten": 0
  },
  {
    "id": "ch_seo",
    "name": "Website / SEO",
    "gruppe": "Organisch",
    "kosten": 0
  },
  {
    "id": "ch_emp",
    "name": "Empfehlung",
    "gruppe": "Organisch",
    "kosten": 0
  },
  {
    "id": "ch_msg",
    "name": "Agentur für Arbeit / Jobcenter",
    "gruppe": "Partner",
    "kosten": 0
  },
  {
    "id": "ch_mes",
    "name": "Messe / Event",
    "gruppe": "Offline",
    "kosten": 0
  },
  {
    "id": "ch_tel",
    "name": "Kaltakquise",
    "gruppe": "Outbound",
    "kosten": 0
  }
]$cfg$::jsonb),
  ('stages', $cfg$[
  {
    "id": "s1",
    "name": "Neu / unbearbeitet",
    "prob": 10,
    "ord": 1
  },
  {
    "id": "s2",
    "name": "Erstkontakt",
    "prob": 25,
    "ord": 2
  },
  {
    "id": "s3",
    "name": "Bedarf geklärt",
    "prob": 45,
    "ord": 3
  },
  {
    "id": "s4",
    "name": "Angebot raus",
    "prob": 65,
    "ord": 4
  },
  {
    "id": "s5",
    "name": "Verhandlung",
    "prob": 85,
    "ord": 5
  }
]$cfg$::jsonb),
  ('templates', $cfg$[
  {
    "id": "t1",
    "name": "Angebot versenden",
    "subject": "Ihr Angebot von {{firma_absender}} – {{kennzeichner}}",
    "body": "Guten Tag {{anrede}} {{nachname}},\n\nvielen Dank für das freundliche Gespräch. Anbei erhalten Sie wie besprochen unser Angebot.\n\nFür Rückfragen stehe ich Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{{bearbeiter}}\n{{firma_absender}}"
  },
  {
    "id": "t2",
    "name": "Anmeldebestätigung Schulung",
    "subject": "Ihre Anmeldung – {{kennzeichner}}",
    "body": "Guten Tag {{anrede}} {{nachname}},\n\nwir bestätigen Ihre Anmeldung. Alle Unterlagen zum Ablauf finden Sie im Anhang.\n\nViele Grüße\n{{bearbeiter}}"
  },
  {
    "id": "t3",
    "name": "Wiedervorlage / Nachfassen",
    "subject": "Kurze Rückfrage zu unserem Gespräch",
    "body": "Guten Tag {{anrede}} {{nachname}},\n\nich komme wie vereinbart auf unser Gespräch zurück. Passt es Ihnen diese Woche für eine kurze Abstimmung?\n\nViele Grüße\n{{bearbeiter}}"
  }
]$cfg$::jsonb),
  ('settings', $cfg${
  "absender": "Terralexx",
  "seq": {},
  "provisionStandard": 5,
  "erstinbetriebnahme": true
}$cfg$::jsonb)
ON CONFLICT (key) DO NOTHING;
