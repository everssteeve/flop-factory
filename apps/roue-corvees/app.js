// Roue des corvées — logique de rotation (fonctions pures, testables sous Node)
// Le branchement à la page est en bas et ne s'exécute que dans un navigateur.

export const STORAGE_KEY = "roue-corvees";
export const MIN_PEOPLE = 2;
export const MIN_CHORES = 1;
export const MSG_MIN = "Ajoutez au moins deux personnes et une corvée.";

/** Normalise un nom : espaces de bord retirés, espaces internes réduits. */
export function normalizeName(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

/** Clé de comparaison : insensible à la casse et aux espaces. */
export function nameKey(raw) {
  return normalizeName(raw).toLocaleLowerCase("fr-FR");
}

/**
 * Ajoute un nom à une liste sans doublon (casse et espaces ignorées).
 * Retourne { list, added } ; list est une nouvelle liste.
 */
export function addName(list, raw) {
  const name = normalizeName(raw);
  if (name === "") return { list: [...list], added: false };
  const key = nameKey(name);
  if (list.some((item) => nameKey(item) === key)) {
    return { list: [...list], added: false };
  }
  return { list: [...list, name], added: true };
}

/** Retire l'élément d'index donné. */
export function removeAt(list, index) {
  return list.filter((_, i) => i !== index);
}

/** Message d'erreur de saisie, ou null si la saisie permet de générer. */
export function validate(people, chores) {
  if (people.length < MIN_PEOPLE || chores.length < MIN_CHORES) {
    return MSG_MIN;
  }
  return null;
}

/** Libellé du compteur de personnes. */
export function countLabel(n) {
  return n === 1 ? "1 personne" : `${n} personnes`;
}

/**
 * Planning de rotation. Semaine w (0-based) : la personne d'index p
 * fait la corvée d'index (p + w) mod C. Chacun passe à la corvée suivante
 * chaque semaine.
 */
export function buildPlan(people, chores, weeks) {
  const plan = [];
  for (let w = 0; w < weeks; w += 1) {
    plan.push({
      week: w + 1,
      assignments: people.map((person, p) => ({
        person,
        chore: chores[(p + w) % chores.length],
      })),
    });
  }
  return plan;
}

/**
 * Point d'entrée de la génération : vérifie la saisie puis calcule le planning.
 * Retourne { error, plan } ; plan est null si la saisie est invalide.
 */
export function prepare(people, chores, weeks) {
  const error = validate(people, chores);
  if (error !== null) return { error, plan: null };
  const n = Math.min(52, Math.max(1, Math.trunc(Number(weeks)) || 1));
  return { error: null, plan: buildPlan(people, chores, n) };
}

/** Texte brut du planning, prêt à copier. */
export function formatPlanText(plan) {
  return plan
    .map((week) => {
      const lines = week.assignments.map((a) => `${a.person} : ${a.chore}`);
      return [`Semaine ${week.week}`, ...lines].join("\n");
    })
    .join("\n\n");
}

/** Lignes de liste à afficher : libellé et état coché (false pour les listes de saisie). */
export function renderItems(list) {
  return list.map((label) => ({ label, checked: false }));
}

/** Lit l'état sauvegardé. Retourne { people, chores } ; vide si absent ou invalide. */
export function loadState(storage) {
  const empty = { people: [], chores: [] };
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (_) {
    return empty;
  }
  if (raw === null || raw === undefined) return empty;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return empty;
  }
  if (!data || typeof data !== "object") return empty;
  const clean = (arr) =>
    Array.isArray(arr)
      ? arr.filter((x) => typeof x === "string").map(normalizeName).filter((x) => x !== "")
      : [];
  return { people: clean(data.people), chores: clean(data.chores) };
}

/** Sauvegarde l'état dans le stockage. Retourne true si réussi. */
export function saveState(storage, state) {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ people: state.people, chores: state.chores })
    );
    return true;
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Branchement à la page (uniquement dans un navigateur)
// ---------------------------------------------------------------------------
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const storage = (() => {
    try {
      return window.localStorage;
    } catch (_) {
      return { getItem: () => null, setItem: () => {} };
    }
  })();

  let state = loadState(storage);

  function fillList(ul, list, onRemove) {
    ul.textContent = "";
    renderItems(list).forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "item";
      const span = document.createElement("span");
      span.textContent = item.label;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-remove";
      btn.textContent = "Retirer";
      btn.setAttribute("aria-label", `Retirer ${item.label}`);
      btn.addEventListener("click", () => onRemove(index));
      li.append(span, btn);
      ul.append(li);
    });
  }

  function refresh() {
    saveState(storage, state);
    fillList($("people-list"), state.people, (i) => {
      state = { ...state, people: removeAt(state.people, i) };
      refresh();
    });
    fillList($("chore-list"), state.chores, (i) => {
      state = { ...state, chores: removeAt(state.chores, i) };
      refresh();
    });
    $("people-count").textContent = countLabel(state.people.length);
  }

  function showPlan(plan) {
    const out = $("plan");
    out.textContent = "";
    plan.forEach((week) => {
      const h = document.createElement("h3");
      h.textContent = `Semaine ${week.week}`;
      const ul = document.createElement("ul");
      ul.className = "plan-week";
      week.assignments.forEach((a) => {
        const li = document.createElement("li");
        li.textContent = `${a.person} : ${a.chore}`;
        ul.append(li);
      });
      out.append(h, ul);
    });
    $("plan-section").hidden = false;
    $("plan-text").value = formatPlanText(plan);
  }

  function hidePlan() {
    $("plan").textContent = "";
    $("plan-text").value = "";
    $("plan-section").hidden = true;
  }

  $("add-person-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("person-input");
    const res = addName(state.people, input.value);
    state = { ...state, people: res.list };
    input.value = "";
    refresh();
  });

  $("add-chore-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("chore-input");
    const res = addName(state.chores, input.value);
    state = { ...state, chores: res.list };
    input.value = "";
    refresh();
  });

  $("generate").addEventListener("click", () => {
    const weeks = Number($("weeks").value);
    const { error, plan } = prepare(state.people, state.chores, weeks);
    const msg = $("message");
    if (error !== null) {
      msg.textContent = error;
      msg.hidden = false;
      hidePlan();
      return;
    }
    msg.textContent = "";
    msg.hidden = true;
    showPlan(plan);
  });

  $("copy").addEventListener("click", async () => {
    const text = $("plan-text");
    const status = $("copy-status");
    try {
      await navigator.clipboard.writeText(text.value);
      status.textContent = "Planning copié.";
    } catch (_) {
      text.focus();
      text.select();
      status.textContent = "Sélectionnez le texte puis copiez-le.";
    }
  });

  $("print").addEventListener("click", () => window.print());

  refresh();
}
