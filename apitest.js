/* Testet die Serverfunktion gegen ein echtes Postgres. */
process.env.DATABASE_URL = "postgresql://postgres@localhost:5433/crmtest";
const fs = require("fs");

/* ESM-Default-Export für den Test nutzbar machen */
const src = fs.readFileSync(__dirname + "/netlify/functions/api.js", "utf8")
  .replace("export default async (req) =>", "const handler = async (req) =>")
  .replace("export const config", "const config")
  .replace(/\/\* Für Tests aus Node heraus \*\/[\s\S]*$/, "")
  + "\nmodule.exports = {handler, hashPass, getSQL};\n";
fs.writeFileSync(__dirname + "/.api.test.js", src);
const {handler, getSQL} = require("./.api.test.js");

const call = async (method, path, body, token) => {
  const req = new Request("https://x.de/api/" + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: token ? {authorization: "Bearer " + token, "content-type": "application/json"} : {}
  });
  const res = await handler(req);
  return {status: res.status, body: await res.json()};
};

const gruen = s => "  \x1b[32m✓\x1b[0m " + s;
const rot = s => "  \x1b[31m✗\x1b[0m " + s;
let fehler = 0;
const pruefe = (name, ok, extra = "") => {
  console.log((ok ? gruen : rot)(name + (extra ? "  → " + extra : "")));
  if (!ok) fehler++;
};

(async () => {
  const sql = await getSQL();
  for (const t of ["audit", "sessions", "documents", "activities", "deals", "contacts", "users", "config"])
    await sql([`TRUNCATE ${t} CASCADE`]);

  console.log("\n\x1b[1mErstinbetriebnahme\x1b[0m");
  let r = await call("POST", "setup", {login: "admin.wagner", pass: "kurz", name: "Michael Wagner"});
  pruefe("zu kurzes Passwort wird abgelehnt", r.status === 400, r.body.error);
  r = await call("POST", "setup", {login: "admin.wagner", pass: "Terralexx2026#", name: "Michael Wagner"});
  pruefe("Administrator wird angelegt", r.status === 200);
  r = await call("POST", "setup", {login: "hacker", pass: "Terralexx2026#"});
  pruefe("zweite Einrichtung wird verweigert", r.status === 409, r.body.error);

  const roh = await sql`SELECT pass_hash, pass_salt FROM users WHERE id = 'u_admin'`;
  pruefe("Passwort liegt nur als Hash vor",
    !JSON.stringify(roh[0]).includes("Terralexx2026#") && roh[0].pass_hash.length === 128,
    roh[0].pass_hash.slice(0, 24) + "…");

  console.log("\n\x1b[1mAnmeldung\x1b[0m");
  r = await call("POST", "login", {login: "admin.wagner", pass: "falsch"});
  pruefe("falsches Passwort abgewiesen", r.status === 401);
  r = await call("POST", "login", {login: "gibtsnicht", pass: "egal"});
  pruefe("unbekannter Benutzer abgewiesen", r.status === 401);
  r = await call("POST", "login", {login: "Admin.Wagner", pass: "Terralexx2026#"});
  pruefe("Anmeldung, Groß-/Kleinschreibung egal", r.status === 200 && !!r.body.token);
  const adminToken = r.body.token;

  r = await call("GET", "state", null, "erfundenes-token");
  pruefe("erfundenes Token wird abgewiesen", r.status === 401);
  r = await call("GET", "state");
  pruefe("ohne Token kein Zugriff", r.status === 401);

  console.log("\n\x1b[1mKonfiguration und Benutzer\x1b[0m");
  const companies = [
    {id: "c_tx", name: "Terralexx", code: "T", color: "#0B0B0C", kinds: ["firmenkunde"]},
    {id: "c_as", name: "AS Bildungsakademie", code: "A", color: "#3D5AA9", kinds: ["firmenkunde", "schueler"]},
    {id: "c_au", name: "Aurin", code: "U", color: "#7D95D2", kinds: ["schueler"]}
  ];
  r = await call("POST", "sync", {ops: [
    {entity: "config", action: "put", id: "companies", data: companies},
    {entity: "config", action: "put", id: "stages", data: [{id: "s1", name: "Neu", prob: 10}]},
    {entity: "user", action: "put", id: "u_gm", data: {name: "Giorgios Maris", kuerzel: "GM",
      email: "georgios@terralexx.de", pass: "Start2026!Xy", role: "vertrieb", active: true, mandanten: ["c_tx"]}},
    {entity: "user", action: "put", id: "u_dd", data: {name: "Denise Diaz", kuerzel: "DD",
      email: "denise@as-bildungsakademie.de", pass: "Start2026!Ab", role: "verwaltung", active: true, mandanten: ["c_as", "c_au"]}}
  ]}, adminToken);
  pruefe("Admin darf Konfiguration und Benutzer schreiben", r.body.ok === 4, JSON.stringify(r.body.abgelehnt));

  console.log("\n\x1b[1mDatensätze anlegen\x1b[0m");
  const kontakt = (id, kz, comp, owner, name) => ({entity: "contact", action: "put", id,
    data: {id, kennzeichner: kz, companyId: comp, ownerId: owner, kind: "firmenkunde",
      status: "neu", channelId: "ch_emp", vorname: "", nachname: name, firma: name,
      email: name.toLowerCase().replace(/\s/g, "") + "@x.de", createdAt: new Date().toISOString()}});
  r = await call("POST", "sync", {ops: [
    kontakt("k1", "T-26-0001", "c_tx", "u_gm", "Sanders Automotive"),
    kontakt("k2", "T-26-0002", "c_tx", "u_gm", "Lindner Maschinenbau"),
    kontakt("k3", "A-26-0001", "c_as", "u_dd", "Brandt Logistik"),
    kontakt("k4", "U-26-0001", "c_au", "u_dd", "Aylin Demir"),
    {entity: "deal", action: "put", id: "d1", data: {id: "d1", title: "Rahmenvertrag", contactId: "k1",
      companyId: "c_tx", ownerId: "u_gm", stageId: "s1", status: "won", value: 46800,
      provisionTyp: "prozent", provisionWert: 7, provisionEmpfaenger: "u_gm"}},
    {entity: "activity", action: "put", id: "a1", data: {id: "a1", contactId: "k1", type: "anruf",
      subject: "Erstgespräch", note: "Bedarf geklärt", at: "2026-08-20", followUpAt: "2026-08-27",
      done: false, ownerId: "u_gm"}},
    {entity: "document", action: "put", id: "f1", data: {id: "f1", contactId: "k1", name: "Angebot.pdf",
      mime: "application/pdf", size: 1234, dataUrl: "data:application/pdf;base64,QUJD"}}
  ]}, adminToken);
  pruefe("7 Datensätze geschrieben", r.body.ok === 7, JSON.stringify(r.body.abgelehnt));

  console.log("\n\x1b[1mMandantentrennung – der eigentliche Test\x1b[0m");
  const state = (await call("GET", "state", null, adminToken)).body;
  pruefe("Admin sieht alle 4 Kontakte", state.contacts.length === 4);

  const gm = (await call("POST", "login", {login: "georgios@terralexx.de", pass: "Start2026!Xy"})).body;
  const sGM = (await call("GET", "state", null, gm.token)).body;
  pruefe("Giorgios sieht nur Terralexx", sGM.contacts.length === 2 &&
    sGM.contacts.every(c => c.companyId === "c_tx"),
    sGM.contacts.map(c => c.kennzeichner).join(", "));
  pruefe("Giorgios bekommt nur zugehörige Chancen", sGM.deals.length === 1);
  pruefe("Giorgios bekommt nur zugehörige Aktivitäten", sGM.activities.length === 1);

  const dd = (await call("POST", "login", {login: "denise@as-bildungsakademie.de", pass: "Start2026!Ab"})).body;
  const sDD = (await call("GET", "state", null, dd.token)).body;
  pruefe("Denise sieht nur A und U", sDD.contacts.length === 2 &&
    sDD.contacts.every(c => ["c_as", "c_au"].includes(c.companyId)),
    sDD.contacts.map(c => c.kennzeichner).join(", "));
  pruefe("Denise sieht Terralexx-Chance nicht", sDD.deals.length === 0);

  console.log("\n\x1b[1mAngriffsversuche\x1b[0m");
  r = await call("POST", "sync", {ops: [kontakt("kX", "A-26-0099", "c_as", "u_gm", "Fremder Mandant")]}, gm.token);
  pruefe("Vertrieb kann nicht in fremden Mandanten schreiben",
    r.body.ok === 0 && r.body.abgelehnt.length === 1, r.body.abgelehnt[0] && r.body.abgelehnt[0].grund);
  r = await call("POST", "sync", {ops: [{entity: "contact", action: "delete", id: "k3"}]}, gm.token);
  pruefe("Vertrieb kann fremden Kontakt nicht löschen", r.body.ok === 0,
    r.body.abgelehnt[0] && r.body.abgelehnt[0].grund);
  r = await call("POST", "sync", {ops: [{entity: "user", action: "put", id: "u_boss",
    data: {name: "Ich", kuerzel: "IC", email: "ich@x.de", pass: "Abcdefghij1", role: "superadmin", active: true}}]}, gm.token);
  pruefe("Vertrieb kann sich nicht selbst zum Admin machen", r.body.ok === 0,
    r.body.abgelehnt[0] && r.body.abgelehnt[0].grund);
  r = await call("POST", "sync", {ops: [{entity: "config", action: "put", id: "companies", data: []}]}, dd.token);
  pruefe("Verwaltung kann Konfiguration nicht ändern", r.body.ok === 0);
  r = await call("GET", "document?id=f1", null, dd.token);
  pruefe("Denise kann Terralexx-Dokument nicht laden", r.status === 403, r.body.error);
  r = await call("GET", "document?id=f1", null, gm.token);
  pruefe("Giorgios kann sein Dokument laden", r.status === 200 && r.body.dataUrl.includes("QUJD"));

  console.log("\n\x1b[1mPasswort und Sitzungen\x1b[0m");
  r = await call("POST", "password", {alt: "falsch", neu: "NeuesPasswort1"}, gm.token);
  pruefe("Wechsel ohne altes Passwort abgelehnt", r.status === 403);
  r = await call("POST", "password", {alt: "Start2026!Xy", neu: "NeuesPasswort1"}, gm.token);
  pruefe("Passwortwechsel funktioniert", r.status === 200);
  r = await call("POST", "login", {login: "georgios@terralexx.de", pass: "NeuesPasswort1"});
  pruefe("Anmeldung mit neuem Passwort", r.status === 200);
  r = await call("POST", "sync", {ops: [{entity: "user", action: "put", id: "u_gm",
    data: {name: "Giorgios Maris", kuerzel: "GM", email: "georgios@terralexx.de",
      role: "vertrieb", active: false, mandanten: ["c_tx"]}}]}, adminToken);
  pruefe("Benutzer sperren funktioniert", r.body.ok === 1);
  r = await call("GET", "state", null, gm.token);
  pruefe("Sitzung des gesperrten Benutzers ist beendet", r.status === 401);

  console.log("\n\x1b[1mDatenmenge\x1b[0m");
  const gross = [];
  for (let i = 0; i < 500; i++) gross.push(kontakt("m" + i, "T-26-" + String(1000 + i), "c_tx", "u_gm", "Firma " + i));
  const t0 = Date.now();
  r = await call("POST", "sync", {ops: gross}, adminToken);
  const tSchreib = Date.now() - t0;
  const t1 = Date.now();
  const gr = await call("GET", "state", null, adminToken);
  const tLese = Date.now() - t1;
  pruefe("500 Kontakte geschrieben", r.body.ok === 500, tSchreib + " ms");
  pruefe("504 Kontakte gelesen", gr.body.contacts.length === 504, tLese + " ms");
  pruefe("Dokumentinhalt nicht im Zustand enthalten",
    gr.body.documents[0] && gr.body.documents[0].dataUrl === null);

  const audit = await sql`SELECT count(*)::int AS n FROM audit`;
  pruefe("Protokoll geschrieben", audit[0].n > 0, audit[0].n + " Einträge");

  console.log(fehler === 0 ? "\n\x1b[32m\x1b[1mAlle Tests bestanden\x1b[0m\n"
    : "\n\x1b[31m\x1b[1m" + fehler + " Test(s) fehlgeschlagen\x1b[0m\n");
  process.exit(fehler ? 1 : 0);
})();
