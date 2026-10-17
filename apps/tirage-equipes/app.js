// Tirage d'équipes — logique de calcul (pure, testable sous Node) et branchement à la page.

export const MESSAGE_MIN_PRENOMS = "Saisissez au moins 2 prénoms";

/**
 * Transforme la saisie (un prénom par ligne) en liste de prénoms.
 * Ignore les lignes vides et les espaces superflus.
 * @param {string} texte
 * @returns {string[]}
 */
export function lirePrenoms(texte) {
  return String(texte ?? "")
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.length > 0);
}

/**
 * Mélange une copie du tableau (Fisher-Yates). `rng` renvoie un nombre dans [0, 1).
 * @param {string[]} liste
 * @param {() => number} rng
 * @returns {string[]}
 */
export function melanger(liste, rng = Math.random) {
  const copie = liste.slice();
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/**
 * Calcule le nombre d'équipes à partir d'un nombre d'équipes ou d'une taille souhaitée.
 * @param {number} nbPrenoms
 * @param {{nombreEquipes?: number, tailleEquipe?: number}} options
 * @returns {number}
 */
export function nombreEquipesPour(nbPrenoms, { nombreEquipes, tailleEquipe } = {}) {
  if (Number.isInteger(nombreEquipes) && nombreEquipes >= 1) {
    return Math.min(nombreEquipes, nbPrenoms);
  }
  if (Number.isInteger(tailleEquipe) && tailleEquipe >= 1) {
    return Math.ceil(nbPrenoms / tailleEquipe);
  }
  return 0;
}

/**
 * Tire une répartition aléatoire et équilibrée : les tailles diffèrent d'au plus 1,
 * les équipes les plus grandes sont les premières.
 * @param {string[]} prenoms
 * @param {{nombreEquipes?: number, tailleEquipe?: number}} options
 * @param {() => number} [rng=Math.random]
 * @returns {{erreur: string|null, equipes: string[][]}}
 */
export function tirerEquipes(prenoms, options = {}, rng = Math.random) {
  if (!Array.isArray(prenoms) || prenoms.length < 2) {
    return { erreur: MESSAGE_MIN_PRENOMS, equipes: [] };
  }
  const nbEquipes = nombreEquipesPour(prenoms.length, options);
  if (nbEquipes < 1) {
    return { erreur: "Indiquez un nombre d'équipes ou une taille d'équipe valide.", equipes: [] };
  }
  const melange = melanger(prenoms, rng);
  const base = Math.floor(melange.length / nbEquipes);
  const reste = melange.length % nbEquipes;
  const equipes = [];
  let curseur = 0;
  for (let i = 0; i < nbEquipes; i++) {
    const taille = base + (i < reste ? 1 : 0);
    equipes.push(melange.slice(curseur, curseur + taille));
    curseur += taille;
  }
  return { erreur: null, equipes };
}

/**
 * Met en forme le résultat, une équipe par ligne.
 * @param {string[][]} equipes
 * @returns {string}
 */
export function formaterResultat(equipes) {
  return equipes
    .map((membres, i) => `Équipe ${i + 1} : ${membres.join(", ")}`)
    .join("\n");
}

// ---------- Branchement à la page (ignoré sous Node) ----------
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const saisie = $("prenoms");
  const choixMode = $("mode");
  const valeur = $("valeur");
  const libelleValeur = $("libelle-valeur");
  const formulaire = $("formulaire");
  const erreur = $("erreur");
  const resultat = $("resultat");
  const sortie = $("sortie");
  const bouton = $("copier");
  const retour = $("retour-copie");

  const majLibelle = () => {
    const parTaille = choixMode.value === "taille";
    libelleValeur.textContent = parTaille ? "Taille d'équipe" : "Nombre d'équipes";
    valeur.value = parTaille ? "4" : "3";
  };

  choixMode.addEventListener("change", majLibelle);

  formulaire.addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    const prenoms = lirePrenoms(saisie.value);
    const nombre = Number.parseInt(valeur.value, 10);
    const options = choixMode.value === "taille"
      ? { tailleEquipe: nombre }
      : { nombreEquipes: nombre };

    const { erreur: message, equipes } = tirerEquipes(prenoms, options);
    if (message) {
      erreur.textContent = message;
      erreur.hidden = false;
      resultat.hidden = true;
      return;
    }
    erreur.hidden = true;
    erreur.textContent = "";
    sortie.textContent = "";
    equipes.forEach((membres, i) => {
      const bloc = document.createElement("section");
      bloc.className = "equipe";
      const titre = document.createElement("h3");
      titre.textContent = `Équipe ${i + 1}`;
      const liste = document.createElement("p");
      liste.textContent = membres.join(", ");
      bloc.append(titre, liste);
      sortie.append(bloc);
    });
    resultat.dataset.texte = formaterResultat(equipes);
    resultat.hidden = false;
    retour.textContent = "";
  });

  bouton.addEventListener("click", async () => {
    const texte = resultat.dataset.texte ?? "";
    try {
      await navigator.clipboard.writeText(texte);
      retour.textContent = "Résultat copié.";
    } catch {
      retour.textContent = "Copie impossible : sélectionnez le texte manuellement.";
    }
  });

  majLibelle();
}
