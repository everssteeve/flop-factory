// Tests sans dépendance : node test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import {
  lirePrenoms,
  tirerEquipes,
  formaterResultat,
  MESSAGE_MIN_PRENOMS,
} from "./app.js";

const ici = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(ici, "index.html"), "utf8");
const appJs = readFileSync(join(ici, "app.js"), "utf8");

function echec(id, err) {
  console.error(`échec ${id} : ${err.message}`);
  process.exit(1);
}

// Générateur pseudo-aléatoire déterministe (mulberry32) pour des tirages reproductibles.
function generateur(graine) {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function verifierMembres(equipes, attendus) {
  const tous = equipes.flat().slice().sort();
  assert.deepEqual(tous, attendus.slice().sort(), "chaque prénom doit apparaître exactement une fois");
}

// Structure HTML/sécurité : vérifiée avant les critères.
try {
  assert.match(html, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"\s*>/);
  assert.match(html, /<title>Tirage d'équipes<\/title>/);
  assert.match(html, /<link[^>]+href="style\.css"/);
  assert.match(html, /<script\s+type="module"\s+src="app\.js"\s*><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i, "pas de script en ligne");
  assert.doesNotMatch(html, /<style[\s>]/i, "pas de style en ligne");
  assert.doesNotMatch(html, /\sstyle\s*=/i, "pas d'attribut style");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "pas d'attribut on*");
  assert.doesNotMatch(html, /https?:\/\/|localhost|\/\/[a-z0-9.-]+\.[a-z]{2,}/i, "pas de ressource externe");
  assert.doesNotMatch(appJs, /\bfetch\s*\(|WebSocket|sendBeacon|innerHTML|outerHTML|insertAdjacentHTML/, "pas de réseau ni HTML dynamique");
  assert.doesNotMatch(appJs, /\.style\b|setAttribute\(\s*["']style["']/, "pas de style inline via JS");
  console.log("ok structure");
} catch (err) {
  echec("structure", err);
}

// AC-1 : 7 prénoms, 3 équipes -> tailles 3, 2, 2 ; chacun apparaît une fois.
try {
  const prenoms = ["Alice", "Bob", "Chloé", "Dan", "Eva", "Farid", "Gaël"];
  for (let graine = 1; graine <= 200; graine++) {
    const { erreur, equipes } = tirerEquipes(prenoms, { nombreEquipes: 3 }, generateur(graine));
    assert.equal(erreur, null);
    assert.deepEqual(equipes.map((e) => e.length), [3, 2, 2]);
    verifierMembres(equipes, prenoms);
  }
  console.log("ok AC-1");
} catch (err) {
  echec("AC-1", err);
}

// AC-2 : 10 prénoms, taille 4 -> 3 équipes de tailles 4, 3, 3 ; chacun apparaît une fois.
try {
  const prenoms = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];
  for (let graine = 1; graine <= 200; graine++) {
    const { erreur, equipes } = tirerEquipes(prenoms, { tailleEquipe: 4 }, generateur(graine));
    assert.equal(erreur, null);
    assert.deepEqual(equipes.map((e) => e.length), [4, 3, 3]);
    verifierMembres(equipes, prenoms);
  }
  console.log("ok AC-2");
} catch (err) {
  echec("AC-2", err);
}

// AC-3 : lignes vides et espaces ignorés.
try {
  assert.deepEqual(lirePrenoms("  Alice \n\n Bob  \n"), ["Alice", "Bob"]);
  assert.deepEqual(lirePrenoms("Alice\r\nBob"), ["Alice", "Bob"]);
  console.log("ok AC-3");
} catch (err) {
  echec("AC-3", err);
}

// AC-4 : un seul prénom -> aucune équipe, message affiché.
try {
  const { erreur, equipes } = tirerEquipes(["Alice"], { nombreEquipes: 2 });
  assert.deepEqual(equipes, []);
  assert.equal(erreur, "Saisissez au moins 2 prénoms");
  assert.equal(MESSAGE_MIN_PRENOMS, "Saisissez au moins 2 prénoms");
  assert.match(html, /id="erreur"[^>]*role="alert"/, "zone d'erreur présente dans la page");
  assert.match(appJs, /erreur\.textContent\s*=\s*message/, "le message est affiché dans la zone d'erreur");
  console.log("ok AC-4");
} catch (err) {
  echec("AC-4", err);
}

// AC-5 : texte copié exact, une équipe par ligne.
try {
  const texte = formaterResultat([["Alice", "Bob"], ["Chloé", "Dan"]]);
  assert.equal(texte, "Équipe 1 : Alice, Bob\nÉquipe 2 : Chloé, Dan");
  assert.match(html, /<button[^>]+id="copier"[^>]*>/, "bouton Copier présent");
  assert.match(appJs, /navigator\.clipboard\.writeText\(texte\)/, "copie via le presse-papiers");
  console.log("ok AC-5");
} catch (err) {
  echec("AC-5", err);
}
