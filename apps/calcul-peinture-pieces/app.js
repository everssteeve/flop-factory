// Calcul Peinture Pièces — logique pure (testable sous Node) + branchement page.

export const MARGE = 1.1;
export const SURFACE_PORTE = 2;
export const SURFACE_FENETRE = 1.5;

export const MSG_DIMENSIONS = "Les dimensions doivent être supérieures à 0.";
export const MSG_OUVERTURES = "Les ouvertures sont trop grandes pour la pièce.";
export const MSG_COUCHES = "Le nombre de couches doit être un entier entre 1 et 4.";
export const MSG_RENDEMENT = "Le rendement d'un pot doit être supérieur à 0.";
export const MSG_COMPTES = "Le nombre de portes et de fenêtres doit être un entier positif ou nul.";

// Convertit une saisie texte (virgule ou point) en nombre ; vide ou invalide → NaN.
export function lireNombre(texte) {
  if (typeof texte === "number") return texte;
  const t = String(texte ?? "").trim().replace(",", ".");
  if (t === "") return NaN;
  return Number(t);
}

function arrondir2(x) {
  return Math.round(x * 100) / 100;
}

function estEntierPositifOuNul(x) {
  return Number.isInteger(x) && x >= 0;
}

// saisie : { longueur, largeur, hauteur, portes, fenetres, couches, rendement } (valeurs texte ou nombres)
// Retourne un message d'erreur, ou null si la saisie est valide.
export function validate(saisie) {
  const L = lireNombre(saisie.longueur);
  const l = lireNombre(saisie.largeur);
  const h = lireNombre(saisie.hauteur);
  for (const d of [L, l, h]) {
    if (!Number.isFinite(d) || d <= 0) return MSG_DIMENSIONS;
  }
  const portes = saisie.portes === "" || saisie.portes == null ? 0 : lireNombre(saisie.portes);
  const fenetres = saisie.fenetres === "" || saisie.fenetres == null ? 0 : lireNombre(saisie.fenetres);
  if (!estEntierPositifOuNul(portes) || !estEntierPositifOuNul(fenetres)) return MSG_COMPTES;
  const couches = lireNombre(saisie.couches);
  if (!Number.isInteger(couches) || couches < 1 || couches > 4) return MSG_COUCHES;
  const rendement = lireNombre(saisie.rendement);
  if (!Number.isFinite(rendement) || rendement <= 0) return MSG_RENDEMENT;
  const murBrut = 2 * (L + l) * h;
  const ouvertures = portes * SURFACE_PORTE + fenetres * SURFACE_FENETRE;
  if (ouvertures > murBrut) return MSG_OUVERTURES;
  return null;
}

// Calcule les surfaces et le nombre de pots. Suppose une saisie valide.
export function calculer(saisie) {
  const erreur = validate(saisie);
  if (erreur !== null) return { ok: false, message: erreur };
  const L = lireNombre(saisie.longueur);
  const l = lireNombre(saisie.largeur);
  const h = lireNombre(saisie.hauteur);
  const portes = saisie.portes === "" || saisie.portes == null ? 0 : lireNombre(saisie.portes);
  const fenetres = saisie.fenetres === "" || saisie.fenetres == null ? 0 : lireNombre(saisie.fenetres);
  const couches = lireNombre(saisie.couches);
  const rendement = lireNombre(saisie.rendement);

  const surfaceMurs = arrondir2(2 * (L + l) * h - portes * SURFACE_PORTE - fenetres * SURFACE_FENETRE);
  const surfacePlafond = arrondir2(L * l);
  const surfaceTotale = arrondir2(surfaceMurs + surfacePlafond);
  // Arrondi à 6 décimales avant ceil pour éviter les erreurs de virgule flottante.
  const besoin = Math.round(surfaceTotale * couches * MARGE / rendement * 1e6) / 1e6;
  const pots = Math.ceil(besoin);

  return { ok: true, surfaceMurs, surfaceTotale, pots };
}

// Formate pour l'affichage (virgule décimale).
export function formaterResultat(res) {
  if (!res.ok) return { erreur: res.message, lignes: [] };
  const fmt = (x) => String(x).replace(".", ",");
  return {
    erreur: "",
    lignes: [
      `Surface des murs à peindre : ${fmt(res.surfaceMurs)} m²`,
      `Surface totale à peindre : ${fmt(res.surfaceTotale)} m²`,
      `Pots de peinture à acheter : ${res.pots}`,
    ],
  };
}

// Branchement à la page : ne s'exécute que dans un navigateur.
if (typeof document !== "undefined") {
  const form = document.getElementById("form-calcul");
  const zoneErreur = document.getElementById("erreur");
  const zoneResultat = document.getElementById("resultat");
  const liste = document.getElementById("lignes-resultat");

  const champ = (id) => document.getElementById(id).value;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const saisie = {
      longueur: champ("longueur"),
      largeur: champ("largeur"),
      hauteur: champ("hauteur"),
      portes: champ("portes"),
      fenetres: champ("fenetres"),
      couches: champ("couches"),
      rendement: champ("rendement"),
    };
    const affichage = formaterResultat(calculer(saisie));
    zoneErreur.textContent = affichage.erreur;
    zoneErreur.hidden = affichage.erreur === "";
    liste.replaceChildren(...affichage.lignes.map((texte) => {
      const li = document.createElement("li");
      li.textContent = texte;
      return li;
    }));
    zoneResultat.hidden = affichage.lignes.length === 0;
  });
}
