// Compteur de scores de jeux : logique pure (testable sous Node) + branchement à la page.

export const STORAGE_KEY = "compteur-scores-jeux:v1";
const MAX_NOM = 30;
const MAX_JOUEURS = 12;

export function createState() {
  return { players: [], lowestWins: false };
}

// Nombre entier (négatif accepté), sinon null.
export function parseScore(texte) {
  const t = String(texte ?? "").trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

// Renvoie { state, error }.
export function addPlayer(state, nomBrut) {
  const nom = String(nomBrut ?? "").trim();
  if (nom === "") return { state, error: "Entrez un nom de joueur." };
  if (nom.length > MAX_NOM) return { state, error: `Le nom ne doit pas dépasser ${MAX_NOM} caractères.` };
  if (state.players.length >= MAX_JOUEURS) return { state, error: `Maximum ${MAX_JOUEURS} joueurs.` };
  const doublon = state.players.some((p) => p.name.toLocaleLowerCase("fr") === nom.toLocaleLowerCase("fr"));
  if (doublon) return { state, error: "Ce joueur existe déjà." };
  return {
    state: { ...state, players: [...state.players, { name: nom, scores: [] }] },
    error: "",
  };
}

// Message d'erreur, ou "" si la saisie est valide. texts : une valeur par joueur, dans l'ordre.
export function validateRound(state, texts) {
  if (state.players.length === 0) return "Ajoutez au moins un joueur avant de saisir une manche.";
  if (!Array.isArray(texts) || texts.length !== state.players.length) return "Saisie incomplète : une valeur par joueur.";
  for (let i = 0; i < texts.length; i++) {
    if (parseScore(texts[i]) === null) {
      return `Points invalides pour ${state.players[i].name} : entrez un nombre entier.`;
    }
  }
  return "";
}

export function addRound(state, values) {
  return {
    ...state,
    players: state.players.map((p, i) => ({ ...p, scores: [...p.scores, values[i]] })),
  };
}

// Renvoie { state, error }. En cas d'erreur, l'état est renvoyé inchangé.
export function submitRound(state, texts) {
  const error = validateRound(state, texts);
  if (error !== "") return { state, error };
  return { state: addRound(state, texts.map(parseScore)), error: "" };
}

export function total(player) {
  return player.scores.reduce((a, b) => a + b, 0);
}

export function roundCount(state) {
  return state.players.reduce((max, p) => Math.max(max, p.scores.length), 0);
}

export function setLowestWins(state, value) {
  return { ...state, lowestWins: value === true };
}

// Remet les scores à zéro : joueurs et mode conservés, manches effacées.
export function resetScores(state) {
  return { ...state, players: state.players.map((p) => ({ ...p, scores: [] })) };
}

// Classement en ordre d'affichage, rang « compétition » (ex aequo partagent le rang, puis saut).
export function rank(state) {
  const liste = state.players.map((p) => ({ name: p.name, total: total(p) }));
  liste.sort((a, b) => (state.lowestWins ? a.total - b.total : b.total - a.total));
  return liste.map((r) => {
    const meilleurs = liste.filter((o) =>
      state.lowestWins ? o.total < r.total : o.total > r.total
    ).length;
    return { ...r, rank: meilleurs + 1 };
  });
}

// Nom du gagnant unique, ou null (aucun joueur, ou ex aequo en tête).
export function winner(state) {
  const premiers = rank(state).filter((r) => r.rank === 1);
  return premiers.length === 1 ? premiers[0].name : null;
}

// Lignes à afficher : checked = joueur(s) en tête.
export function renderItems(state) {
  const detail = (p) => p.scores.join(" + ") || "—";
  return rank(state).map((r) => {
    const joueur = state.players.find((p) => p.name === r.name);
    return {
      label: `${r.rank}. ${r.name} : ${r.total} pt${Math.abs(r.total) > 1 ? "s" : ""} (${detail(joueur)})`,
      checked: r.rank === 1,
    };
  });
}

export function winnerText(state) {
  if (state.players.length === 0) return "";
  const g = winner(state);
  if (g !== null) return `Gagnant : ${g}`;
  return "Pas de gagnant unique : ex aequo en tête.";
}

export function save(storage, state) {
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function restore(storage) {
  let brut = null;
  try {
    brut = storage && typeof storage.getItem === "function" ? storage.getItem(STORAGE_KEY) : null;
  } catch {
    return createState();
  }
  if (!brut) return createState();
  let data;
  try {
    data = JSON.parse(brut);
  } catch {
    return createState();
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.players)) return createState();
  const players = [];
  for (const p of data.players) {
    if (!p || typeof p.name !== "string" || !Array.isArray(p.scores)) return createState();
    if (!p.scores.every((s) => Number.isSafeInteger(s))) return createState();
    players.push({ name: p.name, scores: [...p.scores] });
  }
  return { players, lowestWins: data.lowestWins === true };
}

// ---------- Branchement à la page ----------
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);

  const getStorage = () => {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  };

  const storage = getStorage();
  let state = restore(storage);

  const formJoueur = $("form-joueur");
  const inputNom = $("nom-joueur");
  const formManche = $("form-manche");
  const champs = $("champs-manche");
  const erreur = $("erreur");
  const classement = $("classement");
  const gagnant = $("gagnant");
  const nombre = $("nombre-manches");
  const plusBas = $("plus-bas-gagne");

  function construireChamps() {
    champs.textContent = "";
    state.players.forEach((p, i) => {
      const label = document.createElement("label");
      label.htmlFor = `manche-${i}`;
      label.textContent = `Points de ${p.name}`;
      const input = document.createElement("input");
      input.id = `manche-${i}`;
      input.type = "text";
      input.inputMode = "numeric";
      input.autocomplete = "off";
      input.className = "champ-manche";
      const bloc = document.createElement("div");
      bloc.className = "ligne";
      bloc.append(label, input);
      champs.append(bloc);
    });
  }

  function afficher() {
    classement.textContent = "";
    for (const item of renderItems(state)) {
      const li = document.createElement("li");
      li.textContent = item.label;
      if (item.checked) li.className = "en-tete";
      classement.append(li);
    }
    const n = roundCount(state);
    nombre.textContent = n === 0 ? "Aucune manche" : `Manches : ${n}`;
    gagnant.textContent = winnerText(state);
    plusBas.checked = state.lowestWins;
  }

  function sauver() {
    save(storage, state);
  }

  formJoueur.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = addPlayer(state, inputNom.value);
    if (r.error) {
      inputNom.setAttribute("aria-invalid", "true");
      erreur.textContent = r.error;
      return;
    }
    state = r.state;
    inputNom.value = "";
    inputNom.removeAttribute("aria-invalid");
    erreur.textContent = "";
    sauver();
    construireChamps();
    afficher();
  });

  formManche.addEventListener("submit", (e) => {
    e.preventDefault();
    const textes = state.players.map((_, i) => $(`manche-${i}`).value);
    const r = submitRound(state, textes);
    if (r.error) {
      erreur.textContent = r.error;
      return;
    }
    state = r.state;
    erreur.textContent = "";
    sauver();
    construireChamps();
    afficher();
  });

  plusBas.addEventListener("change", () => {
    state = setLowestWins(state, plusBas.checked);
    sauver();
    afficher();
  });

  $("remise-a-zero").addEventListener("click", () => {
    state = resetScores(state);
    erreur.textContent = "";
    sauver();
    construireChamps();
    afficher();
  });

  construireChamps();
  afficher();
}
