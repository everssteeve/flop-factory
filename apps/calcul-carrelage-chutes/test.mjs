// Tests Node sans dépendance : node test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MESSAGE_INVALIDE,
  validerPiece,
  calculerPiece,
  ajouterPiece,
  totaux,
  formatM2,
  renderTotaux,
  nombreCarreaux,
  nombreBoites,
  resultatCarreaux,
  resultatBoites,
} from "./app.js";

const dossier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dossier, "index.html"), "utf8");

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

function egal(obtenu, attendu, contexte) {
  verifier(
    obtenu === attendu,
    `${contexte} : obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`,
  );
}

const sansOuverture = [];

const tests = [];
function test(id, fn) {
  tests.push({ id, fn });
}

// Structure de la page (lit index.html, ne vérifie pas le texte du source de app.js)
test("page", () => {
  egal((html.match(/<title>([^<]*)<\/title>/) || [])[1], "Calcul carrelage et chutes", "title");
  verifier(
    html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'),
    "meta viewport absente",
  );
  verifier(html.includes('<link rel="stylesheet" href="style.css">'), "lien style.css absent");
  verifier(html.includes('<script type="module" src="app.js"></script>'), "script module app.js absent");
  verifier(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "script en ligne présent");
  verifier(!/<style[\s>]/i.test(html), "balise style présente");
  verifier(!/\sstyle\s*=/i.test(html), "attribut style présent");
  verifier(!/\son[a-z]+\s*=/i.test(html), "attribut de gestionnaire d'événement présent");
  verifier(!/(https?:)?\/\/|localhost/i.test(html), "ressource externe ou localhost présente");
  for (const id of [
    "form-piece", "nom", "longueur", "largeur", "pose", "o1-largeur", "o1-hauteur",
    "o2-largeur", "o2-hauteur", "o3-largeur", "o3-hauteur", "erreur-piece",
    "liste-pieces", "total-nette", "total-commander", "form-carreaux", "cote-carreau",
    "erreur-carreaux", "resultat-carreaux", "form-boites", "couverture-boite",
    "erreur-boites", "resultat-boites",
  ]) {
    verifier(html.includes(`id="${id}"`), `élément #${id} absent de index.html`);
  }
});

test("AC-1", () => {
  const piece = calculerPiece({ longueur: "4", largeur: "3", ouvertures: sansOuverture, pose: "droite" });
  egal(formatM2(piece.nette), "12,00 m²", "surface nette");
  egal(formatM2(piece.commander), "13,20 m²", "surface à commander");
  const { pieces } = ajouterPiece([], { longueur: "4", largeur: "3", ouvertures: sansOuverture, pose: "droite" });
  const affiche = renderTotaux(pieces);
  egal(affiche.commander, "13,20 m²", "total affiché");
});

test("AC-2", () => {
  const ouvertures = [{ largeur: "0,90", hauteur: "2,10" }];
  const piece = calculerPiece({ longueur: "4", largeur: "3", ouvertures, pose: "droite" });
  egal(formatM2(piece.nette), "10,11 m²", "surface nette");
  egal(formatM2(piece.commander), "11,12 m²", "surface à commander");
});

test("AC-3", () => {
  const piece = calculerPiece({ longueur: "4", largeur: "3", ouvertures: sansOuverture, pose: "diagonale" });
  egal(formatM2(piece.commander), "13,80 m²", "surface à commander");
});

test("AC-4", () => {
  egal(nombreCarreaux(13.2, 0.3), 147, "nombre de carreaux");
  const r = resultatCarreaux(13.2, "30");
  egal(r.erreur, null, "erreur carreaux");
  egal(r.texte, "Nombre de carreaux à commander : 147", "texte carreaux");
});

test("AC-5", () => {
  egal(nombreBoites(13.2, 1.44), 10, "nombre de boîtes");
  const r = resultatBoites(13.2, "1,44");
  egal(r.texte, "Nombre de boîtes à commander : 10", "texte boîtes");
});

test("AC-6", () => {
  let pieces = [];
  ({ pieces } = ajouterPiece(pieces, { longueur: "4", largeur: "3", ouvertures: sansOuverture, pose: "droite" }));
  ({ pieces } = ajouterPiece(pieces, { longueur: "3", largeur: "2", ouvertures: sansOuverture, pose: "diagonale" }));
  egal(pieces.length, 2, "nombre de pièces");
  const t = totaux(pieces);
  egal(formatM2(t.nette), "18,00 m²", "surface nette totale");
  egal(formatM2(t.commander), "20,10 m²", "surface totale à commander");
  const affiche = renderTotaux(pieces);
  egal(affiche.nette, "18,00 m²", "nette affichée");
  egal(affiche.commander, "20,10 m²", "à commander affichée");
});

test("AC-7", () => {
  const ouvertures = [{ largeur: "3", hauteur: "2" }];
  const piece = calculerPiece({ longueur: "2", largeur: "2", ouvertures, pose: "droite" });
  egal(piece.nette, 0, "nette brute");
  egal(formatM2(piece.nette), "0,00 m²", "surface nette affichée");
  egal(formatM2(piece.commander), "0,00 m²", "à commander affiché");
  verifier(!formatM2(piece.nette).includes("-"), "valeur négative affichée");
});

test("AC-8", () => {
  const vide = { longueur: "", largeur: "3", ouvertures: sansOuverture, pose: "droite" };
  const negative = { longueur: "-1", largeur: "3", ouvertures: sansOuverture, pose: "droite" };
  egal(validerPiece(vide), MESSAGE_INVALIDE, "message longueur vide");
  egal(validerPiece(negative), MESSAGE_INVALIDE, "message longueur négative");
  const resultat = ajouterPiece([], vide);
  egal(resultat.pieces.length, 0, "pièce ajoutée malgré l'erreur");
  egal(resultat.erreur, "Valeur invalide", "message d'erreur");
  const resultatNeg = ajouterPiece([], negative);
  egal(resultatNeg.pieces.length, 0, "pièce ajoutée malgré valeur négative");
  egal(resultatNeg.erreur, "Valeur invalide", "message d'erreur négatif");
});

for (const { id, fn } of tests) {
  try {
    fn();
    console.log(id === "page" ? "ok page" : `ok ${id}`);
  } catch (erreur) {
    console.error(`échec ${id} : ${erreur.message}`);
    process.exit(1);
  }
}
