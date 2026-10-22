// Tests Node sans dépendance : node test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import {
  traiterSaisie,
  valider,
  calculer,
  formaterVolume,
  MESSAGE_SURFACE,
  MESSAGE_PERSONNES,
} from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

function fail(id, err) {
  console.error(`echec ${id}: ${err && err.message ? err.message : err}`);
  process.exit(1);
}

function check(id, fn) {
  try {
    fn();
  } catch (err) {
    fail(id, err);
  }
  console.log(`ok ${id}`);
}

// Vérifications de la page : structure et politique stricte (pas de code en ligne).
function verifierPage() {
  assert.match(html, /<title>Cartons Déménagement<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<link rel="stylesheet" href="style\.css">/);
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, "script en ligne");
  assert.doesNotMatch(html, /<style[\s>]/i, "style en ligne");
  assert.doesNotMatch(html, /\sstyle\s*=/i, "attribut style");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "gestionnaire on*");
  assert.doesNotMatch(html, /https?:\/\/|localhost/i, "ressource externe");
  for (const id of ["surface", "pieces", "personnes", "calculer", "erreur", "resultat", "out-volume", "out-cartons", "out-marge", "out-total"]) {
    assert.match(html, new RegExp(`id="${id}"`), `id manquant: ${id}`);
  }
  assert.match(html, /<button[^>]*type="submit"[^>]*>Calculer<\/button>/);
}

const saisieValide = { surface: "50", pieces: "2", personnes: "1" };

check("AC-1", () => {
  verifierPage();
  const r = traiterSaisie({ surface: "50", pieces: "2", personnes: "1" });
  assert.deepEqual(r, {
    erreur: null,
    affichage: { volume: "11,3 m³", cartons: "189", marge: "19", total: "208" },
  });
});

check("AC-2", () => {
  const r = traiterSaisie({ surface: "100", pieces: "4", personnes: "3" });
  assert.deepEqual(r, {
    erreur: null,
    affichage: { volume: "22,9 m³", cartons: "382", marge: "39", total: "421" },
  });
});

check("AC-3", () => {
  // Surface vide et surface à 0 : message exact, aucun nombre de cartons.
  for (const surface of ["", "0"]) {
    const r = traiterSaisie({ surface, pieces: "2", personnes: "1" });
    assert.equal(r.erreur, "Indiquez une surface supérieure à 0");
    assert.equal(r.affichage, null);
    assert.equal(valider({ surface, pieces: "2", personnes: "1" }), MESSAGE_SURFACE);
  }
});

check("AC-4", () => {
  for (const personnes of ["0", "0,0"]) {
    const r = traiterSaisie({ surface: "50", pieces: "2", personnes });
    assert.equal(r.erreur, "Indiquez au moins une personne");
    assert.equal(r.affichage, null);
    assert.equal(valider({ surface: "50", pieces: "2", personnes }), MESSAGE_PERSONNES);
  }
});

// Contrôles complémentaires de la logique de calcul (ne remplacent pas les AC).
assert.deepEqual(calculer({ surface: 50, pieces: 2, personnes: 1 }), { volume: 11.3, cartons: 189, marge: 19, total: 208 });
assert.equal(formaterVolume(22.9), "22,9 m³");
assert.equal(valider(saisieValide), null);
