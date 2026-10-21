// Tests Node sans dépendance : node test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { calculer, validate, formaterResultat, MSG_DIMENSIONS, MSG_OUVERTURES } from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

function echec(id, detail) {
  console.error(`echec ${id} : ${detail}`);
  process.exit(1);
}

function attendu(id, condition, detail) {
  if (!condition) echec(id, detail);
}

function saisie(surcharge = {}) {
  return {
    longueur: "4",
    largeur: "3",
    hauteur: "2,5",
    portes: "0",
    fenetres: "0",
    couches: "2",
    rendement: "10",
    ...surcharge,
  };
}

// Structure de la page nécessaire aux critères (lecture de index.html, pas de recherche de chaîne dans le code).
attendu("page", /<title>Calcul Peinture Pièces<\/title>/.test(html), "titre attendu");
attendu("page", /id="erreur"[^>]*role="alert"/.test(html), "zone d'erreur attendue");
attendu("page", /id="lignes-resultat"/.test(html), "liste de résultat attendue");

// AC-1 : 4 × 3 × 2,5, 1 porte, 0 fenêtre, 2 couches, 10 m²/pot
{
  const r = calculer(saisie({ portes: "1" }));
  attendu("AC-1", r.ok === true, `calcul refusé : ${r.message}`);
  attendu("AC-1", r.surfaceTotale === 45, `surface totale ${r.surfaceTotale} ≠ 45`);
  attendu("AC-1", r.pots === 10, `pots ${r.pots} ≠ 10`);
  console.log("ok AC-1");
}

// AC-2 : 4 × 3 × 2,5, 0 porte, 2 fenêtres, 1 couche, 10 m²/pot
{
  const r = calculer(saisie({ fenetres: "2", couches: "1" }));
  attendu("AC-2", r.ok === true, `calcul refusé : ${r.message}`);
  attendu("AC-2", r.surfaceMurs === 32, `surface murs ${r.surfaceMurs} ≠ 32`);
  attendu("AC-2", r.surfaceTotale === 44, `surface totale ${r.surfaceTotale} ≠ 44`);
  attendu("AC-2", r.pots === 5, `pots ${r.pots} ≠ 5`);
  console.log("ok AC-2");
}

// AC-3 : dimension vide ou égale à 0 → aucun pot, message exact
{
  const cas = [
    { longueur: "" },
    { largeur: "0" },
    { hauteur: "0,0" },
  ];
  for (const surcharge of cas) {
    const s = saisie(surcharge);
    const message = validate(s);
    attendu("AC-3", message === MSG_DIMENSIONS, `message ${JSON.stringify(message)} pour ${JSON.stringify(surcharge)}`);
    const r = calculer(s);
    attendu("AC-3", r.ok === false && r.pots === undefined, `pots affiché pour ${JSON.stringify(surcharge)}`);
    const affichage = formaterResultat(r);
    attendu("AC-3", affichage.erreur === MSG_DIMENSIONS && affichage.lignes.length === 0, "affichage incorrect");
  }
  console.log("ok AC-3");
}

// AC-4 : ouvertures plus grandes que les murs → aucun pot, message exact
{
  // 4 × 3 × 2,5 : murs bruts 35 m² ; 20 portes = 40 m²
  const s = saisie({ portes: "20" });
  const message = validate(s);
  attendu("AC-4", message === MSG_OUVERTURES, `message ${JSON.stringify(message)}`);
  const r = calculer(s);
  attendu("AC-4", r.ok === false && r.pots === undefined, "pots affiché alors que les ouvertures dépassent");
  const affichage = formaterResultat(r);
  attendu("AC-4", affichage.erreur === MSG_OUVERTURES && affichage.lignes.length === 0, "affichage incorrect");
  console.log("ok AC-4");
}
