-- =========================================================================
-- TERRALEXX CRM – Schema 1
--
-- Aufbau: feste Spalten für alles, wonach gefiltert, sortiert oder
-- ausgewertet wird; der Rest des Datensatzes liegt in einer JSONB-Spalte.
-- Das hält die Abfragen schnell und erlaubt trotzdem neue Felder in der
-- Anwendung, ohne bei jedem Update eine Schemaänderung zu erzwingen.
-- =========================================================================

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kuerzel     TEXT NOT NULL,
  login       TEXT NOT NULL UNIQUE,     -- E-Mail oder Benutzername, klein geschrieben
  pass_hash   TEXT NOT NULL,            -- PBKDF2-SHA512, kein Klartext
  pass_salt   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('superadmin','verwaltung','vertrieb')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  mandanten   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Konfiguration: Mandanten, Phasen, Kanäle, Vorlagen, Einstellungen
CREATE TABLE IF NOT EXISTS config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id           TEXT PRIMARY KEY,
  kennzeichner TEXT,
  company_id   TEXT NOT NULL,
  owner_id     TEXT,
  kind         TEXT,
  status       TEXT,
  channel_id   TEXT,
  data         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS contacts_owner   ON contacts(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_kennzeichner ON contacts(kennzeichner) WHERE kennzeichner IS NOT NULL;

CREATE TABLE IF NOT EXISTS deals (
  id          TEXT PRIMARY KEY,
  contact_id  TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL,
  owner_id    TEXT,
  stage_id    TEXT,
  status      TEXT,
  value       NUMERIC(14,2) DEFAULT 0,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS deals_company ON deals(company_id);

CREATE TABLE IF NOT EXISTS activities (
  id           TEXT PRIMARY KEY,
  contact_id   TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id      TEXT,
  owner_id     TEXT,
  type         TEXT,
  at           DATE,
  follow_up_at DATE,
  done         BOOLEAN DEFAULT FALSE,
  data         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_contact ON activities(contact_id);
CREATE INDEX IF NOT EXISTS activities_followup ON activities(follow_up_at) WHERE done = FALSE;

-- Dokumente: Metadaten getrennt vom Inhalt, damit die Liste schnell lädt
-- und der Dateiinhalt nur beim Herunterladen gelesen wird.
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  contact_id   TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mime         TEXT,
  size         BIGINT DEFAULT 0,
  uploaded_by  TEXT,
  content      TEXT,                    -- Base64-Data-URL
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_contact ON documents(contact_id);

-- Protokoll: wer hat wann was geändert
CREATE TABLE IF NOT EXISTS audit (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  action     TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at DESC);
