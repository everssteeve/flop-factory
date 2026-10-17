// Tests sans dépendance : node test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import * as app from "./app.js";

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, "index.html"), "utf8");
const appSource = readFileSync(join(dir, "app.js"), "utf8");

function run(id, fn) {
  try {
    fn();
    console.log(`ok ${id}`);
  } catch (err) {
    console.error(`échec ${id} : ${err.message}`);
    process.exit(1);
  }
}

// ---- Garde-fous de la page (politique de sécurité stricte) ----
run("page: structure", () => {
  assert.match(html, /<html[^>]*lang="fr"/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<title>Calcul allure course<\/title>/);
  assert.match(html, /<link rel="stylesheet" href="style\.css">/);
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  for (const id of ["form-allure", "distance", "chrono", "repere", "depart", "calculer", "erreur", "resultats", "allure", "vitesse", "passages"]) {
    assert.match(html, new RegExp(`id="${id}"`), `id manquant : ${id}`);
  }
  assert.match(html, /<button[^>]*id="calculer"[^>]*>Calculer<\/button>/);
});

run("page: pas de ressource externe, pas de script/style en ligne, pas de style/onclick", () => {
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /localhost/);
  assert.doesNotMatch(html, /<style[\s>]/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\sstyle="/);
  assert.doesNotMatch(html, /\son[a-z]+="/);
  assert.doesNotMatch(appSource, /\b(fetch|WebSocket|sendBeacon)\b/);
});

// ---- Critères d'acceptation ----
run("AC-1", () => {
  const r = app.compute({ distance: "10", chrono: "00:50:00", repere: "5", depart: "" });
  assert.equal(r.error, null);
  assert.equal(r.pace.paceLabel, "5:00 /km");
  assert.equal(r.pace.speedLabel, "12,0 km/h");
});

run("AC-2", () => {
  const r = app.compute({ distance: "10", chrono: "00:45:00", repere: "5", depart: "" });
  assert.equal(r.error, null);
  assert.equal(r.pace.paceLabel, "4:30 /km");
  assert.equal(r.pace.speedLabel, "13,3 km/h");
});

run("AC-3", () => {
  const r = app.compute({ distance: "10", chrono: "00:50:00", repere: "5", depart: "" });
  assert.equal(r.error, null);
  assert.deepEqual(r.splits, [
    { label: "5 km", time: "0:25:00" },
    { label: "10 km", time: "0:50:00" },
  ]);
});

run("AC-4", () => {
  const r = app.compute({ distance: "10", chrono: "00:50:00", repere: "5", depart: "10" });
  assert.equal(r.error, null);
  const par = Object.fromEntries(r.splits.map((s) => [s.label, s.time]));
  assert.equal(par["5 km"], "0:25:50");
  assert.equal(par["10 km"], "0:50:50");
});

run("AC-5", () => {
  const cas = [
    { distance: "10", chrono: "" },
    { distance: "10", chrono: "0" },
    { distance: "10", chrono: "00:00:00" },
    { distance: "", chrono: "00:50:00" },
    { distance: "0", chrono: "00:50:00" },
  ];
  for (const c of cas) {
    const saisie = { ...c, repere: "5", depart: "" };
    const msg = app.validate(saisie);
    assert.equal(typeof msg, "string", `pas de message pour ${JSON.stringify(c)}`);
    assert.ok(msg.length > 0);
    assert.match(msg, /^Indiquez|^Choisissez|^Le /, "message d'erreur en français attendu");
    const r = app.compute(saisie);
    assert.equal(r.error, msg);
    assert.equal(r.pace, null);
    assert.equal(r.splits, null);
  }
});

// ---- Fonctions annexes (repères 1 et 2 km, départ, formats) ----
run("calculs annexes", () => {
  const un = app.computeSplits({ distanceKm: 3, targetSec: 900, intervalKm: 1 });
  assert.deepEqual(un.map((s) => s.label), ["1 km", "2 km", "3 km"]);
  assert.equal(un[2].time, "0:15:00");
  assert.equal(app.parseChrono("50:00"), 3000);
  assert.equal(app.parseChrono("1:00:00"), 3600);
  assert.equal(app.parseDistance("21,1"), 21.1);
  assert.equal(app.validate({ distance: "10", chrono: "00:50:00", repere: "5", depart: "abc" }) !== null, true);
});

console.log("Tous les tests passent.");
process.exit(0);
