// Test Node sans dépendance : node test.mjs
import { readFileSync } from "node:fs";
import { calculer, validate, calculerPlants, formaterResultat } from "./app.js";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function echec(id, detail) {
  console.error(`échec ${id} : ${detail}`);
  process.exit(1);
}

function egal(id, reel, attendu) {
  const a = JSON.stringify(reel);
  const b = JSON.stringify(attendu);
  if (a !== b) echec(id, `obtenu ${a}, attendu ${b}`);
}

function ok(id) {
  console.log(`ok ${id}`);
}

// ---- Structure de la page (lue depuis index.html) ----
const titre = html.match(/<title>([^<]*)<\/title>/);
egal("page-titre", titre && titre[1], "Calcul plants massif");
if (!/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html)) echec("page", "viewport manquant");
if (!/<link rel="stylesheet" href="style\.css">/.test(html)) echec("page", "lien style.css manquant");
if (!/<script type="module" src="app\.js">/.test(html)) echec("page", "script module app.js manquant");
if (/<script(?![^>]*\bsrc=)/.test(html)) echec("page", "script en ligne interdit");
if (/<style/.test(html) || /\sstyle="/.test(html) || /\son[a-z]+="/.test(html)) echec("page", "style ou gestionnaire en ligne interdit");
if (/https?:\/\/|localhost/.test(html)) echec("page", "ressource externe ou localhost");
console.log("ok page");

// Champs et bouton utilisés par le parcours des critères
for (const id of ["form-massif", "longueur", "largeur", "ecart", "erreur", "resultat", "resultat-total", "resultat-detail"]) {
  if (!html.includes(`id="${id}"`)) echec("page", `élément #${id} absent`);
}
const boutonCalculer = /<button[^>]*type="submit"[^>]*>Calculer<\/button>/.test(html);
if (!boutonCalculer) echec("AC-1", "bouton Calculer absent de index.html");

// ---- AC-1 : 200 x 100, écart 50 -> 15 plants, 5 par ligne, 3 lignes ----
{
  const calcul = calculerPlants({ longueur: 200, largeur: 100, ecart: 50 });
  egal("AC-1", calcul, { parLigne: 5, lignes: 3, total: 15 });
  const { erreur, resultat } = calculer({ longueur: "200", largeur: "100", ecart: "50" });
  egal("AC-1", erreur, null);
  egal("AC-1", resultat, { total: "15 plants", detail: "5 plants par ligne et 3 lignes" });
  // Texte que la page écrit dans #resultat (total, retour à la ligne, détail)
  egal("AC-1", `${resultat.total}\n${resultat.detail}`, "15 plants\n5 plants par ligne et 3 lignes");
  ok("AC-1");
}

// ---- AC-2 : 30 x 30, écart 30 -> 4 plants, 2 par ligne, 2 lignes (un plant par bord) ----
{
  const calcul = calculerPlants({ longueur: 30, largeur: 30, ecart: 30 });
  egal("AC-2", calcul, { parLigne: 2, lignes: 2, total: 4 });
  const { erreur, resultat } = calculer({ longueur: "30", largeur: "30", ecart: "30" });
  egal("AC-2", erreur, null);
  egal("AC-2", resultat, { total: "4 plants", detail: "2 plants par ligne et 2 lignes" });
  ok("AC-2");
}

// ---- AC-3 : 100 x 20, écart 50 -> 3 plants, 3 par ligne, 1 ligne ----
{
  const calcul = calculerPlants({ longueur: 100, largeur: 20, ecart: 50 });
  egal("AC-3", calcul, { parLigne: 3, lignes: 1, total: 3 });
  const { erreur, resultat } = calculer({ longueur: "100", largeur: "20", ecart: "50" });
  egal("AC-3", erreur, null);
  egal("AC-3", resultat, { total: "3 plants", detail: "3 plants par ligne et 1 ligne" });
  ok("AC-3");
}

// ---- AC-4 : écart 0 ou vide -> message d'erreur, aucun total ----
{
  const avecZero = calculer({ longueur: "200", largeur: "100", ecart: "0" });
  egal("AC-4", avecZero, {
    erreur: "L'écart doit être supérieur à 0 cm.",
    resultat: null,
  });
  const avecVide = calculer({ longueur: "200", largeur: "100", ecart: "" });
  egal("AC-4", avecVide, {
    erreur: "L'écart doit être supérieur à 0 cm.",
    resultat: null,
  });
  egal("AC-4", validate({ longueur: "200", largeur: "100", ecart: "0" }), {
    ok: false,
    message: "L'écart doit être supérieur à 0 cm.",
  });
  ok("AC-4");
}

// ---- Branches de saisie invalide (valeur vide, nulle, négative) ----
{
  egal("AC-4", validate({ longueur: "0", largeur: "100", ecart: "50" }), {
    ok: false,
    message: "La longueur doit être supérieure à 0 cm.",
  });
  egal("AC-4", validate({ longueur: "200", largeur: "-5", ecart: "50" }), {
    ok: false,
    message: "La largeur doit être supérieure à 0 cm.",
  });
  egal("AC-4", validate({ longueur: "", largeur: "100", ecart: "50" }), {
    ok: false,
    message: "La longueur est vide. Saisissez une valeur supérieure à 0 cm.",
  });
  egal("AC-4", calculer({ longueur: "200", largeur: "abc", ecart: "50" }), {
    erreur: "La largeur n'est pas un nombre valide.",
    resultat: null,
  });
  egal("AC-4", validate({ longueur: "200", largeur: "100", ecart: "50" }), {
    ok: true,
    valeurs: { longueur: 200, largeur: 100, ecart: 50 },
  });
}

// ---- Formatage : singulier et pluriel ----
egal("AC-3", formaterResultat({ parLigne: 1, lignes: 1, total: 1 }), {
  total: "1 plant",
  detail: "1 plant par ligne et 1 ligne",
});

process.exit(0);
