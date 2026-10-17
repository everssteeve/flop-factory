// Checklist Valise — logique de l'app.
// Les fonctions de calcul et de stockage sont exportées et n'accèdent pas au DOM.
// Le branchement à la page (initApp) n'est exécuté que si `document` existe.

export const STORAGE_KEY = "checklist-valise:v1";
export const MIN_DAYS = 1;
export const MAX_DAYS = 60;
export const DURATION_ERROR = "Indique une durée entre 1 et 60 jours.";

const SEASONS = ["ete", "hiver", "mi-saison"];
const TRIP_TYPES = ["ville", "montagne", "plage"];

/** Retourne le nombre de jours (entier entre 1 et 60) ou null si la saisie est invalide. */
export function parseDuration(raw) {
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const days = Number(text);
  if (days < MIN_DAYS || days > MAX_DAYS) return null;
  return days;
}

/** Quantité de sous-vêtements : nombre de jours plus un. */
export function underwearQuantity(days) {
  return days + 1;
}

function item(label, quantity) {
  return { label, quantity };
}

/** Articles de base, quelle que soit la saison ou le séjour. */
function baseItems(days) {
  return [
    item("Sous-vêtements", underwearQuantity(days)),
    item("Chaussettes", underwearQuantity(days)),
    item("T-shirts", days),
    item("Pantalon ou jean", Math.max(1, Math.ceil(days / 4))),
    item("Pyjama", 1),
    item("Trousse de toilette", 1),
    item("Brosse à dents", 1),
    item("Chargeur de téléphone", 1),
    item("Papiers d'identité", 1),
  ];
}

const SEASON_ITEMS = {
  ete: (days) => [
    item("Short ou jupe", Math.max(1, Math.ceil(days / 2))),
    item("Lunettes de soleil", 1),
    item("Crème solaire", 1),
    item("Chapeau ou casquette", 1),
  ],
  hiver: (days) => [
    item("Pull ou sweat", Math.max(1, Math.ceil(days / 2))),
    item("Manteau", 1),
    item("Écharpe", 1),
    item("Gants", 1),
    item("Bonnet", 1),
  ],
  "mi-saison": (days) => [
    item("Pull fin", Math.max(1, Math.ceil(days / 2))),
    item("Veste légère", 1),
    item("Parapluie", 1),
  ],
};

const TRIP_ITEMS = {
  ville: () => [item("Chaussures confortables", 1), item("Sac à dos ou petit sac", 1)],
  montagne: () => [
    item("Chaussures de randonnée", 1),
    item("Veste imperméable", 1),
    item("Gourde", 1),
  ],
  plage: () => [
    item("Maillot de bain", 2),
    item("Serviette de plage", 1),
    item("Tongs", 1),
  ],
};

/**
 * Construit la liste d'articles { label, quantity } pour un séjour.
 * Retourne null si la durée est invalide.
 */
export function buildList({ days, season, tripType } = {}) {
  const d = parseDuration(days);
  if (d === null) return null;
  const seasonPart = SEASONS.includes(season) ? SEASON_ITEMS[season](d) : [];
  const tripPart = TRIP_TYPES.includes(tripType) ? TRIP_ITEMS[tripType]() : [];
  return [...baseItems(d), ...seasonPart, ...tripPart];
}

/** Nombre d'articles de la liste dont le libellé figure parmi les cases cochées. */
export function countChecked(items, checked) {
  const set = new Set(checked);
  return items.filter((it) => set.has(it.label)).length;
}

/** Retire des cases cochées les libellés qui ne figurent plus dans la liste. */
export function pruneChecked(items, checked) {
  const labels = new Set(items.map((it) => it.label));
  return checked.filter((label) => labels.has(label));
}

/** Ajoute ou retire un libellé des cases cochées. */
export function toggleChecked(checked, label, on) {
  const set = new Set(checked);
  if (on) set.add(label);
  else set.delete(label);
  return [...set];
}

export function formatProgress(done, total) {
  return `${done} / ${total}`;
}

/** Lit l'état sauvegardé : { trip: {days, season, tripType} | null, checked: [libellés] }. */
export function readState(storage) {
  if (!storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const trip =
      data.trip && parseDuration(data.trip.days) !== null
        ? {
            days: parseDuration(data.trip.days),
            season: data.trip.season,
            tripType: data.trip.tripType,
          }
        : null;
    const checked = Array.isArray(data.checked)
      ? data.checked.filter((s) => typeof s === "string")
      : [];
    return { trip, checked };
  } catch {
    return null;
  }
}

/** Sauvegarde l'état. Retourne false si le stockage est indisponible. */
export function writeState(storage, state) {
  if (!storage) return false;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ trip: state.trip ?? null, checked: state.checked ?? [] })
    );
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Branchement à la page                                               */
/* ------------------------------------------------------------------ */

export function initApp(doc, storage) {
  const $ = (id) => doc.getElementById(id);
  const form = $("trip-form");
  const durationInput = $("duration");
  const seasonSelect = $("season");
  const tripTypeSelect = $("trip-type");
  const errorEl = $("form-error");
  const resultEl = $("result");
  const progressEl = $("progress");
  const itemsEl = $("items");
  const resetBtn = $("reset");

  let items = [];
  let state = { trip: null, checked: [] };

  function persist() {
    writeState(storage, state);
  }

  function renderProgress() {
    progressEl.textContent = formatProgress(countChecked(items, state.checked), items.length);
  }

  function renderItems() {
    itemsEl.textContent = "";
    for (const it of items) {
      const li = doc.createElement("li");
      li.className = "item";

      const label = doc.createElement("label");
      label.className = "item-label";

      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "item-check";
      checkbox.checked = state.checked.includes(it.label);
      checkbox.addEventListener("change", () => {
        state.checked = toggleChecked(state.checked, it.label, checkbox.checked);
        persist();
        renderProgress();
      });

      const name = doc.createElement("span");
      name.className = "item-name";
      name.textContent = it.label;

      const qty = doc.createElement("span");
      qty.className = "item-qty";
      qty.textContent = String(it.quantity);

      label.appendChild(checkbox);
      label.appendChild(name);
      label.appendChild(qty);
      li.appendChild(label);
      itemsEl.appendChild(li);
    }
  }

  function showList() {
    renderItems();
    renderProgress();
    resultEl.hidden = false;
  }

  function hideList() {
    items = [];
    itemsEl.textContent = "";
    progressEl.textContent = formatProgress(0, 0);
    resultEl.hidden = true;
  }

  function generate(trip) {
    items = buildList(trip);
    state = { trip, checked: [] };
    persist();
    showList();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const days = parseDuration(durationInput.value);
    if (days === null) {
      errorEl.textContent = DURATION_ERROR;
      hideList();
      return;
    }
    errorEl.textContent = "";
    generate({
      days,
      season: seasonSelect.value,
      tripType: tripTypeSelect.value,
    });
  });

  resetBtn.addEventListener("click", () => {
    state.checked = [];
    persist();
    renderItems();
    renderProgress();
  });

  // Restauration au chargement : liste et cases sauvegardées.
  const saved = readState(storage);
  if (saved && saved.trip) {
    durationInput.value = String(saved.trip.days);
    seasonSelect.value = saved.trip.season;
    tripTypeSelect.value = saved.trip.tripType;
    items = buildList(saved.trip) ?? [];
    state = {
      trip: saved.trip,
      checked: pruneChecked(items, saved.checked),
    };
    showList();
  }
}

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

if (typeof document !== "undefined") {
  initApp(document, safeLocalStorage());
}
