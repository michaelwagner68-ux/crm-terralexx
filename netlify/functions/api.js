/* =========================================================================
   TERRALEXX CRM – Serverfunktion

   Eine einzige Netlify-Function bedient alle Endpunkte unter /api/*.
   Sie ist der einzige Ort, an dem Daten gelesen und geschrieben werden;
   der Browser bekommt nur, was der angemeldete Benutzer sehen darf.

   Endpunkte
     POST /api/login    {login, pass}      -> {token, user}
     POST /api/logout
     GET  /api/state                       -> vollständiger Datenbestand (gefiltert)
     POST /api/sync     {ops:[...]}        -> Änderungen schreiben
     GET  /api/document?id=...             -> Dateiinhalt
     POST /api/setup    {pass}             -> Erstinbetriebnahme
   ========================================================================= */
const crypto = require("crypto");

/* ------------------------------------------------------ Datenbankzugang - */
let sqlFn = null;
async function getSQL() {
  if (sqlFn) return sqlFn;
  /* Auf Netlify stellt @netlify/database die Verbindung selbst her; es braucht
     keine Zugangsdaten im Quelltext und keine Umgebungsvariable von Hand.
     Nur für die Tests aus Node heraus (apitest.js) tritt der normale
     pg-Treiber mit DATABASE_URL an seine Stelle. */
  if (process.env.DATABASE_URL) {
    const {Pool} = require("pg");
    const pool = new Pool({connectionString: process.env.DATABASE_URL});
    sqlFn = async (strings, ...vals) => {
      const text = strings.reduce((a, s, i) => a + "$" + i + s);
      const r = await pool.query(text, vals);
      return r.rows;
    };
  } else {
    const {getDatabase} = require("@netlify/database");
    sqlFn = getDatabase().sql;
  }
  return sqlFn;
}

/* ------------------------------------------------------------ Passwoerter */
const KDF = {iter: 210000, len: 64, alg: "sha512"};
function hashPass(pass, salt) {
  return crypto.pbkdf2Sync(pass, salt, KDF.iter, KDF.len, KDF.alg).toString("hex");
}
function newSalt() {return crypto.randomBytes(16).toString("hex");}
/* Vergleich in konstanter Zeit, damit die Antwortdauer nichts verrät */
function samePass(pass, salt, expected) {
  const got = Buffer.from(hashPass(pass, salt), "hex");
  const exp = Buffer.from(expected, "hex");
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}
const newToken = () => crypto.randomBytes(32).toString("base64url");

/* ------------------------------------------------------------- Antworten */
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: {"content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", ...headers}
});
const fail = (msg, status = 400) => json({error: msg}, status);

/* ------------------------------------------------------------- Sitzungen */
const SESSION_TAGE = 7;
async function userFromRequest(sql, req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const rows = await sql`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now() AND u.active = TRUE`;
  return rows[0] ? {...rows[0], token} : null;
}

/* Mandanten, die dieser Benutzer sehen darf */
function erlaubteMandanten(user, companies) {
  const alle = companies.map(c => c.id);
  if (user.role === "superadmin") return alle;
  const m = (user.mandanten || []).filter(id => alle.includes(id));
  return m.length ? m : alle;
}

/* -------------------------------------------------------- Zustand lesen - */
async function ladeState(sql, user) {
  const cfgRows = await sql`SELECT key, value FROM config`;
  const cfg = {};
  cfgRows.forEach(r => {cfg[r.key] = r.value;});
  const companies = cfg.companies || [];
  const erlaubt = erlaubteMandanten(user, companies);
  const nurEigene = user.role === "vertrieb";

  const contacts = await sql`
    SELECT data FROM contacts
    WHERE company_id = ANY(${erlaubt})
      AND (${!nurEigene} OR owner_id = ${user.id})
    ORDER BY created_at DESC`;
  const ids = contacts.map(r => r.data.id);

  const deals = ids.length
    ? await sql`SELECT data FROM deals WHERE contact_id = ANY(${ids})`
    : [];
  const activities = ids.length
    ? await sql`SELECT data FROM activities WHERE contact_id = ANY(${ids})`
    : [];
  /* Dateiinhalt bleibt draußen – der kommt einzeln über /api/document */
  const documents = ids.length
    ? await sql`SELECT id, contact_id, name, mime, size, uploaded_by, created_at
                FROM documents WHERE contact_id = ANY(${ids})`
    : [];

  /* Benutzerliste ohne Passwortfelder */
  const users = await sql`
    SELECT id, name, kuerzel, login, role, active, mandanten FROM users ORDER BY name`;

  return {
    schema: cfg.schema || 1,
    users: users.map(u => ({...u, email: u.login, pass: ""})),
    companies, channels: cfg.channels || [], stages: cfg.stages || [],
    templates: cfg.templates || [], settings: cfg.settings || {},
    contacts: contacts.map(r => r.data),
    deals: deals.map(r => r.data),
    activities: activities.map(r => r.data),
    documents: documents.map(d => ({
      id: d.id, contactId: d.contact_id, name: d.name, mime: d.mime,
      size: Number(d.size), uploadedBy: d.uploaded_by,
      uploadedAt: d.created_at, dataUrl: null
    })),
    me: {id: user.id, name: user.name, kuerzel: user.kuerzel, email: user.login,
      role: user.role, mandanten: user.mandanten}
  };
}

/* ------------------------------------------------- Änderungen schreiben - */
const CONFIG_KEYS = ["companies", "channels", "stages", "templates", "settings"];

async function schreibeOps(sql, user, ops) {
  const ergebnis = {ok: 0, abgelehnt: []};
  const cfgRows = await sql`SELECT key, value FROM config WHERE key = 'companies'`;
  const companies = (cfgRows[0] && cfgRows[0].value) || [];
  const erlaubt = erlaubteMandanten(user, companies);
  const istAdmin = user.role === "superadmin";

  for (const op of ops) {
    const {entity, action, id, data} = op;
    try {
      /* --- Konfiguration: nur Super-Admin ------------------------------ */
      if (entity === "config") {
        if (!istAdmin) {ergebnis.abgelehnt.push({op, grund: "keine Berechtigung"}); continue;}
        if (!CONFIG_KEYS.includes(id)) {ergebnis.abgelehnt.push({op, grund: "unbekannter Schlüssel"}); continue;}
        await sql`INSERT INTO config (key, value, updated_at) VALUES (${id}, ${JSON.stringify(data)}, now())
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
        ergebnis.ok++;
        continue;
      }

      /* --- Benutzer: nur Super-Admin ----------------------------------- */
      if (entity === "user") {
        if (!istAdmin) {ergebnis.abgelehnt.push({op, grund: "keine Berechtigung"}); continue;}
        if (action === "delete") {
          if (id === user.id) {ergebnis.abgelehnt.push({op, grund: "eigenes Konto"}); continue;}
          await sql`DELETE FROM users WHERE id = ${id}`;
        } else {
          const login = String(data.email || "").trim().toLowerCase();
          if (!login) {ergebnis.abgelehnt.push({op, grund: "Anmeldename fehlt"}); continue;}
          const vorhanden = await sql`SELECT id, pass_hash, pass_salt FROM users WHERE id = ${id}`;
          let hash, salt;
          if (data.pass) {salt = newSalt(); hash = hashPass(data.pass, salt);}
          else if (vorhanden[0]) {hash = vorhanden[0].pass_hash; salt = vorhanden[0].pass_salt;}
          else {ergebnis.abgelehnt.push({op, grund: "Passwort fehlt"}); continue;}
          await sql`
            INSERT INTO users (id, name, kuerzel, login, pass_hash, pass_salt, role, active, mandanten, updated_at)
            VALUES (${id}, ${data.name}, ${data.kuerzel}, ${login}, ${hash}, ${salt},
                    ${data.role}, ${data.active !== false}, ${JSON.stringify(data.mandanten || [])}, now())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, kuerzel = EXCLUDED.kuerzel, login = EXCLUDED.login,
              pass_hash = EXCLUDED.pass_hash, pass_salt = EXCLUDED.pass_salt,
              role = EXCLUDED.role, active = EXCLUDED.active,
              mandanten = EXCLUDED.mandanten, updated_at = now()`;
          /* Zugang entzogen? Dann alle Sitzungen dieses Benutzers beenden. */
          if (data.active === false) await sql`DELETE FROM sessions WHERE user_id = ${id}`;
        }
        ergebnis.ok++;
        continue;
      }

      /* --- Kontakte ---------------------------------------------------- */
      if (entity === "contact") {
        if (action === "delete") {
          const r = await sql`SELECT company_id, owner_id FROM contacts WHERE id = ${id}`;
          if (!r[0]) {ergebnis.ok++; continue;}
          if (!erlaubt.includes(r[0].company_id) ||
              (user.role === "vertrieb" && r[0].owner_id !== user.id)) {
            ergebnis.abgelehnt.push({op, grund: "keine Berechtigung"}); continue;
          }
          await sql`DELETE FROM contacts WHERE id = ${id}`;
        } else {
          if (!erlaubt.includes(data.companyId)) {
            ergebnis.abgelehnt.push({op, grund: "Mandant nicht zugeordnet"}); continue;
          }
          await sql`
            INSERT INTO contacts (id, kennzeichner, company_id, owner_id, kind, status, channel_id, data, updated_at)
            VALUES (${id}, ${data.kennzeichner || null}, ${data.companyId}, ${data.ownerId || null},
                    ${data.kind || null}, ${data.status || null}, ${data.channelId || null},
                    ${JSON.stringify(data)}, now())
            ON CONFLICT (id) DO UPDATE SET
              kennzeichner = EXCLUDED.kennzeichner, company_id = EXCLUDED.company_id,
              owner_id = EXCLUDED.owner_id, kind = EXCLUDED.kind, status = EXCLUDED.status,
              channel_id = EXCLUDED.channel_id, data = EXCLUDED.data, updated_at = now()`;
        }
        ergebnis.ok++;
        continue;
      }

      /* --- Verkaufschancen --------------------------------------------- */
      if (entity === "deal") {
        if (action === "delete") {await sql`DELETE FROM deals WHERE id = ${id}`; ergebnis.ok++; continue;}
        if (!erlaubt.includes(data.companyId)) {
          ergebnis.abgelehnt.push({op, grund: "Mandant nicht zugeordnet"}); continue;
        }
        await sql`
          INSERT INTO deals (id, contact_id, company_id, owner_id, stage_id, status, value, data, updated_at)
          VALUES (${id}, ${data.contactId || null}, ${data.companyId}, ${data.ownerId || null},
                  ${data.stageId || null}, ${data.status || null}, ${Number(data.value) || 0},
                  ${JSON.stringify(data)}, now())
          ON CONFLICT (id) DO UPDATE SET
            contact_id = EXCLUDED.contact_id, company_id = EXCLUDED.company_id,
            owner_id = EXCLUDED.owner_id, stage_id = EXCLUDED.stage_id, status = EXCLUDED.status,
            value = EXCLUDED.value, data = EXCLUDED.data, updated_at = now()`;
        ergebnis.ok++;
        continue;
      }

      /* --- Aktivitäten -------------------------------------------------- */
      if (entity === "activity") {
        if (action === "delete") {await sql`DELETE FROM activities WHERE id = ${id}`; ergebnis.ok++; continue;}
        await sql`
          INSERT INTO activities (id, contact_id, deal_id, owner_id, type, at, follow_up_at, done, data, updated_at)
          VALUES (${id}, ${data.contactId || null}, ${data.dealId || null}, ${data.ownerId || null},
                  ${data.type || null}, ${data.at || null}, ${data.followUpAt || null},
                  ${!!data.done}, ${JSON.stringify(data)}, now())
          ON CONFLICT (id) DO UPDATE SET
            contact_id = EXCLUDED.contact_id, deal_id = EXCLUDED.deal_id, owner_id = EXCLUDED.owner_id,
            type = EXCLUDED.type, at = EXCLUDED.at, follow_up_at = EXCLUDED.follow_up_at,
            done = EXCLUDED.done, data = EXCLUDED.data, updated_at = now()`;
        ergebnis.ok++;
        continue;
      }

      /* --- Dokumente ---------------------------------------------------- */
      if (entity === "document") {
        if (action === "delete") {await sql`DELETE FROM documents WHERE id = ${id}`; ergebnis.ok++; continue;}
        await sql`
          INSERT INTO documents (id, contact_id, name, mime, size, uploaded_by, content)
          VALUES (${id}, ${data.contactId || null}, ${data.name}, ${data.mime || null},
                  ${Number(data.size) || 0}, ${user.id}, ${data.dataUrl || null})
          ON CONFLICT (id) DO NOTHING`;
        ergebnis.ok++;
        continue;
      }

      ergebnis.abgelehnt.push({op, grund: "unbekannter Datentyp"});
    } catch (e) {
      ergebnis.abgelehnt.push({op, grund: String(e.message || e)});
    }
  }

  if (ergebnis.ok > 0) {
    await sql`INSERT INTO audit (user_id, entity, entity_id, action)
              VALUES (${user.id}, 'sync', NULL, ${ergebnis.ok + " Änderungen"})`;
  }
  return ergebnis;
}

/* --------------------------------------------------------------- Router - */
export default async (req) => {
  const url = new URL(req.url);
  const pfad = url.pathname.replace(/^\/api\/?/, "");
  let sql;
  try {sql = await getSQL();}
  catch (e) {return fail("Datenbank nicht erreichbar: " + e.message, 503);}

  try {
    /* --- Erstinbetriebnahme: nur solange es keinen Benutzer gibt ------- */
    if (pfad === "setup" && req.method === "POST") {
      const vorhanden = await sql`SELECT count(*)::int AS n FROM users`;
      if (vorhanden[0].n > 0) return fail("Es gibt bereits Benutzer.", 409);
      const {login, pass, name} = await req.json();
      if (!login || !pass || pass.length < 10)
        return fail("Anmeldename und ein Passwort mit mindestens 10 Zeichen sind nötig.", 400);
      const salt = newSalt();
      await sql`INSERT INTO users (id, name, kuerzel, login, pass_hash, pass_salt, role, active, mandanten)
                VALUES ('u_admin', ${name || "Administrator"}, ${(name || "AD").slice(0, 2).toUpperCase()},
                        ${String(login).toLowerCase()}, ${hashPass(pass, salt)}, ${salt},
                        'superadmin', TRUE, '[]'::jsonb)`;
      return json({ok: true});
    }

    /* --- Anmeldung ----------------------------------------------------- */
    if (pfad === "login" && req.method === "POST") {
      const {login, pass} = await req.json();
      const rows = await sql`SELECT * FROM users WHERE login = ${String(login || "").trim().toLowerCase()}`;
      const u = rows[0];
      /* Auch ohne Treffer rechnen, damit die Antwortzeit nichts verrät */
      const gueltig = u ? samePass(pass || "", u.pass_salt, u.pass_hash)
                        : (hashPass(pass || "", "dummy"), false);
      if (!u || !gueltig) return fail("E-Mail oder Passwort stimmt nicht.", 401);
      if (!u.active) return fail("Dieser Zugang ist deaktiviert.", 403);
      const token = newToken();
      await sql`INSERT INTO sessions (token, user_id, expires_at)
                VALUES (${token}, ${u.id}, now() + ${SESSION_TAGE + " days"}::interval)`;
      await sql`DELETE FROM sessions WHERE expires_at < now()`;
      await sql`INSERT INTO audit (user_id, entity, action) VALUES (${u.id}, 'session', 'Anmeldung')`;
      return json({token, user: {id: u.id, name: u.name, kuerzel: u.kuerzel,
        email: u.login, role: u.role, mandanten: u.mandanten}});
    }

    /* --- ab hier ist eine gültige Sitzung nötig ------------------------ */
    const user = await userFromRequest(sql, req);
    if (!user) return fail("Nicht angemeldet.", 401);

    if (pfad === "logout" && req.method === "POST") {
      await sql`DELETE FROM sessions WHERE token = ${user.token}`;
      return json({ok: true});
    }

    if (pfad === "state" && req.method === "GET") {
      return json(await ladeState(sql, user));
    }

    if (pfad === "sync" && req.method === "POST") {
      const {ops} = await req.json();
      if (!Array.isArray(ops)) return fail("Keine Änderungen übergeben.");
      if (ops.length > 500) return fail("Zu viele Änderungen auf einmal (max. 500).");
      return json(await schreibeOps(sql, user, ops));
    }

    if (pfad === "document" && req.method === "GET") {
      const id = url.searchParams.get("id");
      const rows = await sql`
        SELECT d.name, d.mime, d.content, c.company_id, c.owner_id
        FROM documents d LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE d.id = ${id}`;
      if (!rows[0]) return fail("Nicht gefunden.", 404);
      const cfg = await sql`SELECT value FROM config WHERE key = 'companies'`;
      const erlaubt = erlaubteMandanten(user, (cfg[0] && cfg[0].value) || []);
      if (!erlaubt.includes(rows[0].company_id)) return fail("Kein Zugriff.", 403);
      return json({name: rows[0].name, mime: rows[0].mime, dataUrl: rows[0].content});
    }

    /* --- eigenes Passwort ändern --------------------------------------- */
    if (pfad === "password" && req.method === "POST") {
      const {alt, neu} = await req.json();
      if (!samePass(alt || "", user.pass_salt, user.pass_hash))
        return fail("Das bisherige Passwort stimmt nicht.", 403);
      if (!neu || neu.length < 10) return fail("Das neue Passwort braucht mindestens 10 Zeichen.", 400);
      const salt = newSalt();
      await sql`UPDATE users SET pass_hash = ${hashPass(neu, salt)}, pass_salt = ${salt}, updated_at = now()
                WHERE id = ${user.id}`;
      await sql`DELETE FROM sessions WHERE user_id = ${user.id} AND token <> ${user.token}`;
      return json({ok: true});
    }

    return fail("Unbekannter Endpunkt: " + pfad, 404);
  } catch (e) {
    console.error("API-Fehler:", e);
    return fail("Serverfehler: " + (e.message || e), 500);
  }
};

export const config = {path: "/api/*"};

/* Für Tests aus Node heraus */
if (typeof module !== "undefined") {
  module.exports = Object.assign(module.exports || {}, {hashPass, newSalt, samePass, ladeState, schreibeOps, getSQL});
}
