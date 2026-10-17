// Tests sans dépendance : node test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import {
  createState, addPlayer, submitRound, validateRound, total, rank, winner,
  setLowestWins, roundCount, renderItems, save, restore, STORAGE_KEY,
} from "./app.js";

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, "index.html"), "utf8");

// Faux stockage
function fauxStockage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}

// Construit une partie via les fonctions publiques
function partie(joueurs, manches, lowestWins = false) {
  let s = createState();
  for (const nom of joueurs) {
    const r = addPlayer(s, nom);
    assert.equal(r.error, "", `ajout de ${nom}`);
    s = r.state;
  }
  for (const m of manches) {
    const r = submitRound(s, m);
    assert.equal(r.error, "", `manche ${m}`);
    s = r.state;
  }
  return setLowestWins(s, lowestWins);
}

const ok = (id) => console.log(`ok ${id}`);
const checks = [];
const check = (id, fn) => checks.push([id, fn]);

check("AC-1", () => {
  const s = partie(["Alice", "Bob"], [["10", "3"], ["5", "4"]], false);
  const classement = rank(s);
  assert.equal(total(s.players[0]), 15, "total Alice");
  assert.equal(total(s.players[1]), 7, "total Bob");
  assert.equal(classement[0].name, "Alice");
  assert.equal(classement[0].rank, 1);
  assert.equal(winner(s), "Alice");
});

check("AC-2", () => {
  const s = partie(["Alice", "Bob"], [["10", "3"], ["5", "4"]], true);
  assert.equal(total(s.players[0]), 15);
  assert.equal(total(s.players[1]), 7);
  assert.equal(rank(s)[0].name, "Bob");
  assert.equal(rank(s)[0].rank, 1);
  assert.equal(winner(s), "Bob");
});

check("AC-3", () => {
  const s = partie(["Alice", "Bob"], [["10", "7"], ["5", "8"]], false);
  assert.equal(total(s.players[0]), 15);
  assert.equal(total(s.players[1]), 15);
  const r = rank(s);
  assert.equal(r[0].rank, 1);
  assert.equal(r[1].rank, 1);
  assert.equal(winner(s), null, "pas de gagnant unique");
  // Ex aequo : rang suivant saute
  const s2 = partie(["A", "B", "C"], [["5", "5", "1"]], false);
  assert.deepEqual(rank(s2).map((x) => x.rank), [1, 1, 3]);
});

check("AC-4", () => {
  let s = partie(["Alice", "Bob"], [["10", "3"], ["5", "4"]], false);
  const r = submitRound(s, ["2", "0"]);
  assert.equal(r.error, "");
  s = r.state;
  assert.equal(total(s.players[0]), 17, "total Alice");
  assert.equal(total(s.players[1]), 7, "total Bob");
  assert.equal(roundCount(s), 3, "nombre de manches");
});

check("AC-5", () => {
  const s = partie(["Alice", "Bob"], [["10", "3"]], false);
  for (const invalide of [["abc", "2"], ["", "2"], ["1", " "], ["1.5", "2"]]) {
    const r = submitRound(s, invalide);
    assert.notEqual(r.error, "", `message d'erreur pour ${JSON.stringify(invalide)}`);
    assert.deepEqual(r.state, s, "état inchangé");
    assert.equal(total(r.state.players[0]), 10);
    assert.equal(roundCount(r.state), 1);
  }
  assert.notEqual(validateRound(s, ["abc", "1"]), "");
  assert.equal(validateRound(s, ["-2", "0"]), "", "entier négatif accepté");
});

check("AC-6", () => {
  const s = partie(["Alice", "Bob"], [["10", "3"], ["5", "4"]], true);
  const storage = fauxStockage();
  save(storage, s);
  const relu = restore(storage);
  assert.deepEqual(relu.players.map((p) => p.name), ["Alice", "Bob"]);
  assert.deepEqual(relu.players.map(total), [15, 7]);
  assert.deepEqual(relu.players.map((p) => p.scores), [[10, 5], [3, 4]]);
  assert.equal(relu.lowestWins, true, "mode restauré");
  assert.deepEqual(renderItems(relu), renderItems(s), "affichage identique");
  // Stockage vide ou corrompu : état par défaut, sans erreur
  assert.deepEqual(restore(fauxStockage()), createState());
  assert.deepEqual(restore(fauxStockage({ [STORAGE_KEY]: "{pas du json" })), createState());
});

// Rendu : chaque ligne du classement
check("AC-rendu", () => {
  const s = partie(["Alice", "Bob"], [["10", "3"]], false);
  const items = renderItems(s);
  assert.equal(items[0].checked, true);
  assert.equal(items[1].checked, false);
  assert.match(items[0].label, /Alice : 10 pts/);
});

for (const [id, fn] of checks) {
  try {
    fn();
    ok(id);
  } catch (err) {
    console.error(`ECHEC ${id} : ${err.message}`);
    process.exit(1);
  }
}

// Vérifications de la page (structure et politique de sécurité)
const pageChecks = [
  ["page-titre", () => assert.match(html, /<title>Compteur de scores de jeux<\/title>/)],
  ["page-viewport", () => assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/)],
  ["page-style", () => assert.match(html, /<link rel="stylesheet" href="style\.css">/)],
  ["page-module", () => assert.match(html, /<script type="module" src="app\.js"><\/script>/)],
  ["page-securite", () => {
    assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false, "script en ligne");
    assert.equal(/\bstyle\s*=/i.test(html), false, "attribut style");
    assert.equal(/\bon[a-z]+\s*=/i.test(html), false, "gestionnaire inline");
    assert.equal(/https?:\/\/|localhost/i.test(html), false, "ressource externe");
  }],
];
for (const [id, fn] of pageChecks) {
  try {
    fn();
    ok(id);
  } catch (err) {
    console.error(`ECHEC ${id} : ${err.message}`);
    process.exit(1);
  }
}
process.exit(0);
