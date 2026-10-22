// Calcul du nombre de cartons à prévoir pour un déménagement.
// Hypothèses forfaitaires (spec) : 0,2 m³/m², 0,5 m³/pièce, 0,3 m³/personne,
// carton de 0,06 m³, marge de 10 %.

export const HYPOTHESES = Object.freeze({
  m3ParM2: 0.2,
  m3ParPiece: 0.5,
  m3ParPersonne: 0.3,
  m3ParCarton: 0.06,
  tauxMarge: 0.1,
});

export const MESSAGE_SURFACE = "Indiquez une surface supérieure à 0";
export const MESSAGE_PERSONNES = "Indiquez au moins une personne";
export const MESSAGE_PIECES = "Indiquez un nombre de pièces (0 ou plus)";
export const MESSAGE_PERSONNES_ENTIER = "Indiquez un nombre entier de personnes";
export const MESSAGE_PIECES_ENTIER = "Indiquez un nombre entier de pièces";

// Convertit un texte saisi en nombre (virgule ou point). Renvoie NaN si vide ou invalide.
export function parseNombre(texte) {
  if (typeof texte !== "string") return NaN;
  const propre = texte.trim().replace(",", ".");
  if (propre === "") return NaN;
  const n = Number(propre);
  return Number.isFinite(n) ? n : NaN;
}

// Vérifie la saisie. Renvoie null si valide, sinon le message d'erreur en français.
export function valider(saisie) {
  const surface = parseNombre(saisie.surface);
  if (Number.isNaN(surface) || surface <= 0) return MESSAGE_SURFACE;

  const pieces = parseNombre(saisie.pieces);
  if (Number.isNaN(pieces) || pieces < 0) return MESSAGE_PIECES;
  if (!Number.isInteger(pieces)) return MESSAGE_PIECES_ENTIER;

  const personnes = parseNombre(saisie.personnes);
  if (Number.isNaN(personnes) || personnes < 1) return MESSAGE_PERSONNES;
  if (!Number.isInteger(personnes)) return MESSAGE_PERSONNES_ENTIER;

  return null;
}

// Arrondi à une précision décimale donnée, pour éviter le bruit de virgule flottante.
function arrondi(n, decimales) {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

// Calcule volume, cartons, marge et total à partir d'une saisie valide (nombres).
export function calculer({ surface, pieces, personnes }) {
  const volume = arrondi(
    surface * HYPOTHESES.m3ParM2 +
      pieces * HYPOTHESES.m3ParPiece +
      personnes * HYPOTHESES.m3ParPersonne,
    2,
  );
  const cartons = Math.ceil(arrondi(volume / HYPOTHESES.m3ParCarton, 6));
  const marge = Math.ceil(arrondi(cartons * HYPOTHESES.tauxMarge, 6));
  const total = cartons + marge;
  return { volume, cartons, marge, total };
}

// Formate le volume en français : 11.3 -> "11,3 m³", 22.9 -> "22,9 m³".
export function formaterVolume(volume) {
  let texte = arrondi(volume, 2).toFixed(2);
  if (texte.endsWith("0")) texte = texte.slice(0, -1);
  return `${texte.replace(".", ",")} m³`;
}

// Formate le résultat pour l'affichage.
export function formaterResultat(resultat) {
  return {
    volume: formaterVolume(resultat.volume),
    cartons: String(resultat.cartons),
    marge: String(resultat.marge),
    total: String(resultat.total),
  };
}

// Point d'entrée unique : saisie brute -> { erreur, affichage }.
// En cas d'erreur, aucun affichage de cartons n'est produit.
export function traiterSaisie(saisie) {
  const erreur = valider(saisie);
  if (erreur !== null) return { erreur, affichage: null };
  const resultat = calculer({
    surface: parseNombre(saisie.surface),
    pieces: parseNombre(saisie.pieces),
    personnes: parseNombre(saisie.personnes),
  });
  return { erreur: null, affichage: formaterResultat(resultat) };
}

// ---- Branchement à la page (ignoré sous Node) ----
if (typeof document !== "undefined") {
  const form = document.getElementById("form");
  const erreurEl = document.getElementById("erreur");
  const resultatEl = document.getElementById("resultat");
  const sortie = {
    volume: document.getElementById("out-volume"),
    cartons: document.getElementById("out-cartons"),
    marge: document.getElementById("out-marge"),
    total: document.getElementById("out-total"),
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const saisie = {
      surface: document.getElementById("surface").value,
      pieces: document.getElementById("pieces").value,
      personnes: document.getElementById("personnes").value,
    };
    const { erreur, affichage } = traiterSaisie(saisie);
    if (erreur !== null) {
      erreurEl.textContent = erreur;
      erreurEl.hidden = false;
      resultatEl.hidden = true;
      return;
    }
    erreurEl.textContent = "";
    erreurEl.hidden = true;
    sortie.volume.textContent = affichage.volume;
    sortie.cartons.textContent = affichage.cartons;
    sortie.marge.textContent = affichage.marge;
    sortie.total.textContent = affichage.total;
    resultatEl.hidden = false;
  });
}
