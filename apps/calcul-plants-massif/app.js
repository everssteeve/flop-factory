// Calcul plants massif : logique de calcul pure (sans DOM) + branchement à la page.

/**
 * Valide une saisie brute (chaînes issues du formulaire).
 * Retourne { ok: true, valeurs: { longueur, largeur, ecart } } ou { ok: false, message }.
 */
export function validate(saisie) {
  const champs = [
    { cle: "longueur", libelle: "La longueur" },
    { cle: "largeur", libelle: "La largeur" },
    { cle: "ecart", libelle: "L'écart" },
  ];
  const valeurs = {};
  for (const { cle, libelle } of champs) {
    const brut = saisie && saisie[cle] != null ? String(saisie[cle]).trim().replace(",", ".") : "";
    if (brut === "") {
      return {
        ok: false,
        message: cle === "ecart"
          ? "L'écart doit être supérieur à 0 cm."
          : `${libelle} est vide. Saisissez une valeur supérieure à 0 cm.`,
      };
    }
    const nombre = Number(brut);
    if (!Number.isFinite(nombre)) {
      return { ok: false, message: `${libelle} n'est pas un nombre valide.` };
    }
    if (nombre <= 0) {
      return {
        ok: false,
        message: cle === "ecart"
          ? "L'écart doit être supérieur à 0 cm."
          : `${libelle} doit être supérieure à 0 cm.`,
      };
    }
    valeurs[cle] = nombre;
  }
  return { ok: true, valeurs };
}

/**
 * Calcule le nombre de plants sur un rectangle, en plaçant un plant sur chaque bord.
 * Entrées en centimètres, valeurs déjà validées (> 0).
 */
export function calculerPlants({ longueur, largeur, ecart }) {
  const parLigne = Math.floor(longueur / ecart + 1e-9) + 1;
  const lignes = Math.floor(largeur / ecart + 1e-9) + 1;
  return { parLigne, lignes, total: parLigne * lignes };
}

/** Pluriel simple français. */
function pluriel(n, singulier, pluriel_) {
  return n === 1 ? singulier : pluriel_;
}

/** Texte affiché pour un résultat : { total: "15 plants", detail: "5 plants par ligne et 3 lignes" }. */
export function formaterResultat({ parLigne, lignes, total }) {
  return {
    total: `${total} ${pluriel(total, "plant", "plants")}`,
    detail: `${parLigne} ${pluriel(parLigne, "plant", "plants")} par ligne et ${lignes} ${pluriel(lignes, "ligne", "lignes")}`,
  };
}

/**
 * Fonction complète appelée par la page : saisie brute -> { erreur, resultat }.
 * En cas d'erreur, resultat vaut null (aucun total faux n'est produit).
 */
export function calculer(saisie) {
  const v = validate(saisie);
  if (!v.ok) {
    return { erreur: v.message, resultat: null };
  }
  const calcul = calculerPlants(v.valeurs);
  return { erreur: null, resultat: formaterResultat(calcul) };
}

// ---- Branchement à la page (uniquement dans un navigateur) ----
if (typeof document !== "undefined") {
  const formulaire = document.getElementById("form-massif");
  const zoneErreur = document.getElementById("erreur");
  const zoneResultat = document.getElementById("resultat");
  const totalEl = document.getElementById("resultat-total");
  const detailEl = document.getElementById("resultat-detail");

  formulaire.addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    const { erreur, resultat } = calculer({
      longueur: document.getElementById("longueur").value,
      largeur: document.getElementById("largeur").value,
      ecart: document.getElementById("ecart").value,
    });
    if (erreur) {
      zoneErreur.textContent = erreur;
      zoneErreur.hidden = false;
      zoneResultat.hidden = true;
      return;
    }
    zoneErreur.textContent = "";
    zoneErreur.hidden = true;
    totalEl.textContent = resultat.total;
    detailEl.textContent = resultat.detail;
    zoneResultat.hidden = false;
  });
}
