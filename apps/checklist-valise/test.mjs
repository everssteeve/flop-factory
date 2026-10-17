// Test Node sans dépendance : `node test.mjs`
// Vérifie chaque critère d'acceptation de spec.json en exécutant le code de app.js
// (fonctions de calcul, et initApp sur un DOM minimal simulé).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");
const css = readFileSync(join(here, "style.css"), "utf8");
const jsSource = readFileSync(join(here, "app.js"), "utf8");

const app = await import("./app.js");
const { initApp, buildList, parseDuration, STORAGE_KEY } = app;

// Texte du message d'erreur tel que exigé par le critère AC-4 (écrit en dur ici,
// pour vérifier la valeur réellement affichée et non une constante importée).
const EXPECTED_DURATION_ERROR = "Indique une durée entre 1 et 60 jours.";

/* ------------------------------------------------------------------ */
/* DOM minimal simulé                                                  */
/* ------------------------------------------------------------------ */

class FakeNode {
  constructor(tag, id = null) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.value = "";
    this.checked = false;
    this.type = "";
    this.className = "";
    this._text = "";
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }
  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  dispatch(type) {
    const event = { type, target: this, preventDefault() { event.defaultPrevented = true; } };
    for (const fn of this.listeners[type] || []) fn(event);
    return event;
  }
}

function makeDoc() {
  const byId = new Map();
  for (const m of html.matchAll(/<([a-zA-Z]+)\b[^>]*\bid="([^"]+)"/g)) {
    byId.set(m[2], new FakeNode(m[1], m[2]));
  }
  return {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new FakeNode(tag),
  };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    raw: map,
  };
}

function el(doc, id) {
  const node = doc.getElementById(id);
  if (!node) throw new Error(`élément #${id} absent de index.html`);
  return node;
}

function findByClass(node, cls) {
  if (node.className === cls) return node;
  for (const child of node.children) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return null;
}

/** Lignes affichées : { li, name, qty, checkbox } */
function rows(doc) {
  return el(doc, "items").children.map((li) => {
    const label = li.children[0];
    return {
      li,
      checkbox: findByClass(label, "item-check"),
      name: findByClass(label, "item-name").textContent,
      qty: findByClass(label, "item-qty").textContent,
    };
  });
}

function rowNames(doc) {
  return rows(doc).map((r) => r.name);
}

function rowFor(doc, name) {
  const row = rows(doc).find((r) => r.name === name);
  if (!row) throw new Error(`article « ${name} » absent de la liste affichée`);
  return row;
}

function generate(doc, { duration, season, tripType }) {
  el(doc, "duration").value = duration;
  el(doc, "season").value = season;
  el(doc, "trip-type").value = tripType;
  el(doc, "trip-form").dispatch("submit");
}

function toggle(doc, name, on) {
  const row = rowFor(doc, name);
  row.checkbox.checked = on;
  row.checkbox.dispatch("change");
}

function savedState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/* ------------------------------------------------------------------ */
/* Vérifications                                                       */
/* ------------------------------------------------------------------ */

function fail(id, message) {
  console.error(`not ok ${id} - ${message}`);
  process.exit(1);
}

function assertThat(id, condition, message) {
  if (!condition) fail(id, message);
}

function ok(id) {
  console.log(`ok ${id}`);
}

// --- Vérifications structurelles (politique de sécurité et contraintes) ---

assertThat("structure", /<title>Checklist Valise<\/title>/.test(html), "titre de la page");
console.log("ok structure: titre");
assertThat(
  "structure",
  /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1">/.test(html),
  "meta viewport"
);
console.log("ok structure: viewport");
assertThat("structure", /<html[^>]*\blang="fr"/.test(html), "langue français");
assertThat("structure", /<link[^>]+href="style\.css"/.test(html), "lien style.css");
assertThat(
  "structure",
  /<script\s+type="module"\s+src="app\.js"><\/script>/.test(html),
  "script module app.js"
);
console.log("ok structure: liens locaux");
assertThat(
  "structure",
  !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) && !/<style[\s>]/i.test(html),
  "aucun script ni style en ligne"
);
assertThat("structure", !/\sstyle\s*=/i.test(html) && !/\son[a-z]+\s*=/i.test(html), "aucun style= ni on*=");
assertThat(
  "structure",
  !/https?:\/\/|localhost|\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(html),
  "aucune ressource externe dans index.html"
);
assertThat("structure", !/https?:\/\/|localhost|@import|url\(\s*["']?(?!data:)[a-z]/i.test(css), "style.css sans ressource externe");
assertThat(
  "structure",
  !/\b(fetch|WebSocket|sendBeacon|XMLHttpRequest|innerHTML|eval)\b|\.style\b/.test(jsSource),
  "app.js sans réseau, innerHTML ni style inline"
);
console.log("ok structure: politique de sécurité");

// --- AC-1 ---
{
  const doc = makeDoc();
  initApp(doc, makeStorage());
  generate(doc, { duration: "5", season: "ete", tripType: "ville" });
  const sous = rows(doc).find((r) => r.name === "Sous-vêtements");
  assertThat("AC-1", sous !== undefined, "article « Sous-vêtements » absent");
  assertThat("AC-1", sous.qty === "6", `quantité attendue 6, obtenue ${sous && sous.qty}`);
  assertThat("AC-1", underwearOk(5), "fonction de quantité");
  ok("AC-1");
}
function underwearOk(days) {
  const list = buildList({ days, season: "ete", tripType: "ville" });
  return list.find((i) => i.label === "Sous-vêtements").quantity === days + 1;
}

// --- AC-2 ---
{
  const doc = makeDoc();
  initApp(doc, makeStorage());
  generate(doc, { duration: "3", season: "hiver", tripType: "montagne" });
  const names = rowNames(doc);
  assertThat("AC-2", names.includes("Bonnet"), "« Bonnet » absent");
  assertThat("AC-2", names.includes("Chaussures de randonnée"), "« Chaussures de randonnée » absent");
  ok("AC-2");
}

// --- AC-3 ---
{
  const doc = makeDoc();
  initApp(doc, makeStorage());
  generate(doc, { duration: "3", season: "ete", tripType: "plage" });
  const names = rowNames(doc);
  assertThat("AC-3", names.includes("Maillot de bain"), "« Maillot de bain » absent");
  assertThat("AC-3", !names.includes("Bonnet"), "« Bonnet » ne doit pas figurer en été à la plage");
  ok("AC-3");
}

// --- AC-4 ---
{
  for (const bad of ["", "0", "61"]) {
    const doc = makeDoc();
    initApp(doc, makeStorage());
    // Une liste valide était affichée avant la saisie invalide.
    generate(doc, { duration: "2", season: "ete", tripType: "ville" });
    assertThat("AC-4", rows(doc).length > 0, "liste préalable attendue");
    generate(doc, { duration: bad, season: "ete", tripType: "ville" });
    assertThat(
      "AC-4",
      el(doc, "form-error").textContent === EXPECTED_DURATION_ERROR,
      `message affiché pour « ${bad} » : « ${el(doc, "form-error").textContent} »`
    );
    assertThat("AC-4", rows(doc).length === 0, `aucune liste ne doit être affichée pour « ${bad} »`);
    assertThat("AC-4", el(doc, "result").hidden === true, `section résultat masquée pour « ${bad} »`);
  }
  // Bornes valides et saisies invalides vérifiées côté calcul.
  assertThat("AC-4", parseDuration("") === null, "durée vide");
  assertThat("AC-4", parseDuration("0") === null, "durée 0");
  assertThat("AC-4", parseDuration("61") === null, "durée 61");
  assertThat("AC-4", parseDuration("1") === 1 && parseDuration("60") === 60, "bornes 1 et 60 acceptées");
  // Une saisie valide efface le message d'erreur.
  const doc = makeDoc();
  initApp(doc, makeStorage());
  generate(doc, { duration: "0", season: "ete", tripType: "ville" });
  generate(doc, { duration: "4", season: "ete", tripType: "ville" });
  assertThat("AC-4", el(doc, "form-error").textContent === "", "message effacé après saisie valide");
  assertThat("AC-4", rows(doc).length > 0, "liste affichée après saisie valide");
  ok("AC-4");
}

// --- AC-5 (génération, cochage, compteur, stockage, rechargement) ---
{
  const storage = makeStorage();
  const doc = makeDoc();
  initApp(doc, storage);
  generate(doc, { duration: "5", season: "ete", tripType: "ville" });
  const n = rows(doc).length;
  assertThat("AC-5", n > 1, "liste générée attendue");
  toggle(doc, "Chargeur de téléphone", true);
  assertThat(
    "AC-5",
    el(doc, "progress").textContent === `1 / ${n}`,
    `compteur attendu « 1 / ${n} », obtenu « ${el(doc, "progress").textContent} »`
  );
  const state = savedState(storage);
  assertThat("AC-5", state !== null, `clé ${STORAGE_KEY} absente du localStorage`);
  assertThat(
    "AC-5",
    Array.isArray(state.checked) && state.checked.includes("Chargeur de téléphone"),
    "« Chargeur de téléphone » absent des articles cochés stockés"
  );
  assertThat("AC-5", STORAGE_KEY === "checklist-valise:v1", "clé de stockage");

  // Rechargement de la page : initApp relit le stockage et restaure liste et cases.
  const reloaded = makeDoc();
  initApp(reloaded, storage);
  assertThat("AC-5", rows(reloaded).length === n, "liste restaurée après rechargement");
  assertThat(
    "AC-5",
    rowFor(reloaded, "Chargeur de téléphone").checkbox.checked === true,
    "case restaurée après rechargement"
  );
  assertThat(
    "AC-5",
    rows(reloaded).filter((r) => r.checkbox.checked).length === 1,
    "une seule case cochée après rechargement"
  );
  assertThat(
    "AC-5",
    el(reloaded, "progress").textContent === `1 / ${n}`,
    "compteur restauré après rechargement"
  );
  ok("AC-5");
}

// --- AC-6 (réinitialisation) ---
{
  const storage = makeStorage();
  const doc = makeDoc();
  initApp(doc, storage);
  generate(doc, { duration: "5", season: "ete", tripType: "ville" });
  const n = rows(doc).length;
  const toCheck = [rowNames(doc)[0], rowNames(doc)[1], "Chargeur de téléphone"];
  for (const name of toCheck) toggle(doc, name, true);
  assertThat(
    "AC-6",
    el(doc, "progress").textContent === `${toCheck.length} / ${n}`,
    "compteur avant réinitialisation"
  );
  el(doc, "reset").dispatch("click");
  assertThat(
    "AC-6",
    rows(doc).every((r) => r.checkbox.checked === false),
    "toutes les cases doivent être décochées"
  );
  assertThat(
    "AC-6",
    el(doc, "progress").textContent === `0 / ${n}`,
    `compteur attendu « 0 / ${n} », obtenu « ${el(doc, "progress").textContent} »`
  );
  const state = savedState(storage);
  assertThat(
    "AC-6",
    state !== null && Array.isArray(state.checked) && state.checked.length === 0,
    "localStorage sans aucun article coché"
  );
  // Après rechargement, plus rien n'est coché.
  const reloaded = makeDoc();
  initApp(reloaded, storage);
  assertThat(
    "AC-6",
    rows(reloaded).every((r) => r.checkbox.checked === false),
    "aucune case cochée après rechargement"
  );
  ok("AC-6");
}

process.exit(0);
