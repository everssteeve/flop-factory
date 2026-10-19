// Calcul carrelage et chutes : logique de calcul (pure, testable sous Node)
// et branchement à la page (uniquement si un document existe).

export const MESSAGE_INVALIDE = "Valeur invalide";

// Taux de chutes ajoutés à la surface nette selon le type de pose.
export const TAUX_CHUTES = {
  droite: 0.10,
  diagonale: 0.15,
  motifs: 0.20,
};

export const LIBELLES_POSE = {
  droite: "pose droite",
  diagonale: "pose diagonale",
  motifs: "pose en motifs",
};

// Lit un nombre saisi en mètres (ou tout autre nombre). Accepte la virgule décimale.
// Renvoie null si la saisie est vide, non numérique, infinie ou négative.
export function parseNombre(valeur) {
  if (typeof valeur === "number") {
    return Number.isFinite(valeur) && valeur >= 0 ? valeur : null;
  }
  if (typeof valeur !== "string") return null;
  const texte = valeur.trim().replace(",", ".");
  if (texte === "") return null;
  const nombre = Number(texte);
  if (!Number.isFinite(nombre) || nombre < 0) return null;
  return nombre;
}

// Analyse une liste d'ouvertures { largeur, hauteur } saisies en texte.
// Une ouverture dont les deux champs sont vides est ignorée ; une ouverture
// à moitié remplie ou avec une valeur invalide rend la liste invalide.
export function analyserOuvertures(ouvertures) {
  let surface = 0;
  for (const ouverture of ouvertures || []) {
    const vide = (v) => v === undefined || v === null || String(v).trim() === "";
    if (vide(ouverture.largeur) && vide(ouverture.hauteur)) continue;
    const largeur = parseNombre(ouverture.largeur);
    const hauteur = parseNombre(ouverture.hauteur);
    if (largeur === null || hauteur === null) {
      return { valide: false, surface: 0 };
    }
    surface += largeur * hauteur;
  }
  return { valide: true, surface };
}

// Renvoie le message d'erreur de la saisie d'une pièce, ou null si elle est valide.
export function validerPiece(saisie) {
  if (parseNombre(saisie.longueur) === null) return MESSAGE_INVALIDE;
  if (parseNombre(saisie.largeur) === null) return MESSAGE_INVALIDE;
  if (!Object.prototype.hasOwnProperty.call(TAUX_CHUTES, saisie.pose)) return MESSAGE_INVALIDE;
  if (!analyserOuvertures(saisie.ouvertures).valide) return MESSAGE_INVALIDE;
  return null;
}

// Calcule une pièce à partir d'une saisie valide. Renvoie null si la saisie est invalide.
export function calculerPiece(saisie) {
  if (validerPiece(saisie) !== null) return null;
  const longueur = parseNombre(saisie.longueur);
  const largeur = parseNombre(saisie.largeur);
  const { surface: surfaceOuvertures } = analyserOuvertures(saisie.ouvertures);
  const brute = longueur * largeur;
  // La surface nette ne peut jamais être négative, même si les ouvertures dépassent.
  const nette = Math.max(0, brute - surfaceOuvertures);
  const commander = nette * (1 + TAUX_CHUTES[saisie.pose]);
  return {
    nom: typeof saisie.nom === "string" ? saisie.nom.trim() : "",
    pose: saisie.pose,
    longueur,
    largeur,
    brute,
    surfaceOuvertures,
    nette,
    commander,
  };
}

// Ajoute une pièce à la liste si la saisie est valide.
// Renvoie { pieces, erreur } ; en cas d'erreur, la liste est inchangée.
export function ajouterPiece(pieces, saisie) {
  const erreur = validerPiece(saisie);
  if (erreur !== null) return { pieces, erreur };
  return { pieces: [...pieces, calculerPiece(saisie)], erreur: null };
}

// Totaux (surface nette et surface à commander) pour l'ensemble des pièces.
export function totaux(pieces) {
  return pieces.reduce(
    (cumul, piece) => ({
      nette: cumul.nette + piece.nette,
      commander: cumul.commander + piece.commander,
    }),
    { nette: 0, commander: 0 },
  );
}

// Formate un nombre avec une virgule décimale et un nombre fixe de décimales.
export function formatNombre(valeur, decimales) {
  const facteur = 10 ** decimales;
  const arrondi = Math.round((valeur + Number.EPSILON) * facteur) / facteur;
  return arrondi.toFixed(decimales).replace(".", ",");
}

export function formatM2(valeur) {
  return `${formatNombre(valeur, 2)} m²`;
}

// Lignes à afficher pour la liste des pièces.
export function renderPieces(pieces) {
  if (pieces.length === 0) {
    return [{ label: "Aucune pièce ajoutée pour l'instant." }];
  }
  return pieces.map((piece, index) => {
    const nom = piece.nom || `Pièce ${index + 1}`;
    const dimensions = `${formatNombre(piece.longueur, 2)} m × ${formatNombre(piece.largeur, 2)} m`;
    return {
      label:
        `${nom} : ${dimensions}, ${LIBELLES_POSE[piece.pose]}, ` +
        `surface nette ${formatM2(piece.nette)}, à commander ${formatM2(piece.commander)}`,
    };
  });
}

// Textes des totaux pour l'affichage.
export function renderTotaux(pieces) {
  const t = totaux(pieces);
  return { nette: formatM2(t.nette), commander: formatM2(t.commander) };
}

// Nombre de carreaux carrés entiers (arrondi à l'entier supérieur).
// surfaceM2 : surface à commander ; coteM : côté du carreau en mètres.
export function nombreCarreaux(surfaceM2, coteM) {
  const surfaceCarreau = coteM * coteM;
  return Math.ceil(surfaceM2 / surfaceCarreau - 1e-9);
}

// Nombre de boîtes (arrondi à l'entier supérieur).
export function nombreBoites(surfaceM2, couvertureBoiteM2) {
  return Math.ceil(surfaceM2 / couvertureBoiteM2 - 1e-9);
}

// Résultat affiché pour le calcul des carreaux à partir du côté saisi en cm.
export function resultatCarreaux(surfaceM2, coteSaisiCm) {
  const coteCm = parseNombre(coteSaisiCm);
  if (coteCm === null || coteCm <= 0) return { erreur: MESSAGE_INVALIDE, texte: "" };
  const n = nombreCarreaux(surfaceM2, coteCm / 100);
  return { erreur: null, texte: `Nombre de carreaux à commander : ${n}` };
}

// Résultat affiché pour le calcul des boîtes à partir de la couverture saisie en m².
export function resultatBoites(surfaceM2, couvertureSaisie) {
  const couverture = parseNombre(couvertureSaisie);
  if (couverture === null || couverture <= 0) return { erreur: MESSAGE_INVALIDE, texte: "" };
  const n = nombreBoites(surfaceM2, couverture);
  return { erreur: null, texte: `Nombre de boîtes à commander : ${n}` };
}

// ---------- Branchement à la page ----------

function demarrer(doc) {
  const el = (id) => doc.getElementById(id);
  let pieces = [];

  const lireSaisiePiece = () => ({
    nom: el("nom").value,
    longueur: el("longueur").value,
    largeur: el("largeur").value,
    pose: el("pose").value,
    ouvertures: [1, 2, 3].map((i) => ({
      largeur: el(`o${i}-largeur`).value,
      hauteur: el(`o${i}-hauteur`).value,
    })),
  });

  const afficherListe = () => {
    const liste = el("liste-pieces");
    liste.textContent = "";
    for (const item of renderPieces(pieces)) {
      const li = doc.createElement("li");
      li.textContent = item.label;
      liste.appendChild(li);
    }
    const t = renderTotaux(pieces);
    el("total-nette").textContent = t.nette;
    el("total-commander").textContent = t.commander;
  };

  el("form-piece").addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    const resultat = ajouterPiece(pieces, lireSaisiePiece());
    el("erreur-piece").textContent = resultat.erreur ?? "";
    if (resultat.erreur !== null) return;
    pieces = resultat.pieces;
    afficherListe();
    el("form-piece").reset();
    el("pose").value = "droite";
  });

  el("form-carreaux").addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    const r = resultatCarreaux(totaux(pieces).commander, el("cote-carreau").value);
    el("erreur-carreaux").textContent = r.erreur ?? "";
    el("resultat-carreaux").textContent = r.erreur ? "" : r.texte;
  });

  el("form-boites").addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    const r = resultatBoites(totaux(pieces).commander, el("couverture-boite").value);
    el("erreur-boites").textContent = r.erreur ?? "";
    el("resultat-boites").textContent = r.erreur ? "" : r.texte;
  });

  afficherListe();
}

if (typeof document !== "undefined") {
  demarrer(document);
}
