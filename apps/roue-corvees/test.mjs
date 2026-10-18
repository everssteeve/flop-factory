// Tests de la Roue des corvées — `node test.mjs`
// Aucune dépendance. Sortie code 1 au premier échec.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import {
  addName,
  buildPlan,
  countLabel,
  formatPlanText,
  loadState,
  prepare,
  renderItems,
  saveState,
  validate,
  MSG_MIN,
  STORAGE_KEY,
} from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}

function check(id, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`échec ${id}`);
    console.error(err);
    process.exit(1);
  }
  console.log(`ok ${id}`);
}

// AC-1 : rotation d'une semaine à l'autre (Alice→Poubelles, Bruno→Sol, Chloé→Vaisselle en semaine 2)
check("AC-1", () => {
  const people = ["Alice", "Bruno", "Chloé"];
  const chores = ["Vaisselle", "Poubelles", "Sol"];
  // Semaine 1 : Alice-Vaisselle, Bruno-Poubelles, Chloé-Sol
  const w1 = prepare(people, chores, 3);
  assert.equal(w1.error, null);
  assert.deepEqual(w1.plan[0].assignments, [
    { person: "Alice", chore: "Vaisselle" },
    { person: "Bruno", chore: "Poubelles" },
    { person: "Chloé", chore: "Sol" },
  ]);
  assert.equal(w1.plan.length, 3);
  // Semaine 2
  assert.deepEqual(w1.plan[1].assignments, [
    { person: "Alice", chore: "Poubelles" },
    { person: "Bruno", chore: "Sol" },
    { person: "Chloé", chore: "Vaisselle" },
  ]);
});

// AC-2 : 4 personnes × 4 corvées sur 4 semaines, chaque corvée une fois par personne
check("AC-2", () => {
  const people = ["Alice", "Bruno", "Chloé", "Dani"];
  const chores = ["Vaisselle", "Poubelles", "Sol", "Courses"];
  const { error, plan } = prepare(people, chores, 4);
  assert.equal(error, null);
  assert.equal(plan.length, 4);
  for (const person of people) {
    const done = plan.map((w) => w.assignments.find((a) => a.person === person).chore);
    assert.deepEqual([...done].sort(), [...chores].sort(), `${person} : ${done.join(", ")}`);
  }
});

// AC-3 : une seule personne, ou aucune corvée → aucun planning et message exact
check("AC-3", () => {
  // Saisie invalide : 1 personne
  const one = prepare(["Alice"], ["Vaisselle"], 3);
  assert.deepEqual(one, { error: MSG_MIN, plan: null });
  assert.equal(MSG_MIN, "Ajoutez au moins deux personnes et une corvée.");
  // Saisie invalide : 0 personne
  assert.deepEqual(prepare([], ["Vaisselle"], 3), { error: MSG_MIN, plan: null });
  // Saisie invalide : aucune corvée
  assert.deepEqual(prepare(["Alice", "Bruno"], [], 3), { error: MSG_MIN, plan: null });
  // Branche validate directe
  assert.equal(validate(["Alice"], ["Vaisselle"]), MSG_MIN);
  assert.equal(validate([], []), MSG_MIN);
  assert.equal(validate(["Alice", "Bruno"], ["Vaisselle"]), null);
  // Le page ne doit rien afficher : pas de texte de planning
  assert.equal(formatPlanText(prepare(["Alice"], ["Vaisselle"], 3).plan ?? []), "");
  // Le HTML doit prévoir la zone de message d'erreur
  assert.match(html, /id="message"[^>]*role="alert"/);
});

// AC-4 : 'alice ' ne doit pas s'ajouter à 'Alice' ; le compteur reste à 1 personne
check("AC-4", () => {
  const { list, added } = addName(["Alice"], "alice ");
  assert.equal(added, false);
  assert.deepEqual(list, ["Alice"]);
  assert.equal(countLabel(list.length), "1 personne");
  // Même comportement après relecture du stockage au chargement
  const state = loadState(fakeStorage({ [STORAGE_KEY]: JSON.stringify({ people: ["Alice"], chores: [] }) }));
  const again = addName(state.people, "  ALICE  ");
  assert.equal(again.added, false);
  assert.equal(countLabel(again.list.length), "1 personne");
  // Un vrai nouveau prénom s'ajoute bien
  assert.deepEqual(addName(["Alice"], "Bruno"), { list: ["Alice", "Bruno"], added: true });
});

// Relecture du stockage au chargement (branches : valeur présente, absente, invalide)
check("restore", () => {
  const stored = fakeStorage({
    [STORAGE_KEY]: JSON.stringify({ people: ["Alice", "Bruno"], chores: ["Sol"] }),
  });
  assert.deepEqual(loadState(stored), { people: ["Alice", "Bruno"], chores: ["Sol"] });
  assert.deepEqual(loadState(fakeStorage()), { people: [], chores: [] });
  assert.deepEqual(loadState(fakeStorage({ [STORAGE_KEY]: "{pas du json" })), { people: [], chores: [] });
  assert.deepEqual(loadState(fakeStorage({ [STORAGE_KEY]: "null" })), { people: [], chores: [] });
  // Aller-retour sauvegarde → relecture
  const s = fakeStorage();
  assert.equal(saveState(s, { people: ["Chloé"], chores: ["Sol"] }), true);
  assert.deepEqual(loadState(s), { people: ["Chloé"], chores: ["Sol"] });
  // Affichage des listes
  assert.deepEqual(renderItems(["Alice", "Bruno"]), [
    { label: "Alice", checked: false },
    { label: "Bruno", checked: false },
  ]);
});

// Vérifications structurelles de la page (politique de sécurité, pas un critère)
check("page", () => {
  assert.match(html, /<title>Roue des corvées<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<link rel="stylesheet" href="style\.css">/);
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(html, /\sstyle=|\sonclick=|localhost|https?:\/\//);
});
