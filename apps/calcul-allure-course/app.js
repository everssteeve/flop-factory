// Calcul allure course — logique de calcul (pure, testable sous Node) et branchement à la page.

export const SLOW_START_KM = 5;
export const REPERES_KM = [1, 2, 5];

const pad2 = (n) => String(n).padStart(2, "0");

/** "h:mm:ss" ou "mm:ss" -> secondes. Retourne null si le format est invalide. */
export function parseChrono(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const parts = t.split(":").map((p) => p.trim());
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length === 3) {
    const [h, m, s] = nums;
    if (m > 59 || s > 59) return null;
    return h * 3600 + m * 60 + s;
  }
  if (nums.length === 2) {
    const [m, s] = nums;
    if (s > 59) return null;
    return m * 60 + s;
  }
  return null;
}

/** Distance en km (virgule ou point décimal) -> nombre, ou null. */
export function parseDistance(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Surcroît de secondes par km ; vide = 0 ; retourne null si invalide. */
export function parseDepart(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (t === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Message d'erreur en français, ou null si la saisie est valide. */
export function validate(saisie = {}) {
  const distance = parseDistance(saisie.distance);
  if (distance === null || distance <= 0) {
    return "Indiquez une distance supérieure à 0 km (par exemple 10 ou 21,1).";
  }
  const chrono = parseChrono(saisie.chrono);
  if (chrono === null || chrono <= 0) {
    return "Indiquez un chrono visé supérieur à 0, au format h:mm:ss ou mm:ss (par exemple 00:50:00).";
  }
  if (!REPERES_KM.includes(Number(saisie.repere))) {
    return "Choisissez un repère de passage de 1, 2 ou 5 km.";
  }
  if (parseDepart(saisie.depart) === null) {
    return "Le surcroît de départ doit être un nombre de secondes par km, positif ou nul.";
  }
  return null;
}

/** Secondes -> "h:mm:ss". */
export function formatHms(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad2(m)}:${pad2(s % 60)}`;
}

/** Secondes par km -> "m:ss /km". */
export function formatPace(secPerKm) {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${pad2(s % 60)} /km`;
}

/** km/h -> "12,0 km/h". */
export function formatSpeed(kmh) {
  return `${kmh.toFixed(1).replace(".", ",")} km/h`;
}

function formatKm(k) {
  return String(Math.round(k * 100) / 100).replace(".", ",");
}

/**
 * Temps de passage à chaque repère, jusqu'à l'arrivée.
 * Les premiers SLOW_START_KM km sont courus à (allure visée + surcroît).
 */
export function computeSplits({ distanceKm, targetSec, intervalKm, slowSecPerKm = 0 }) {
  const base = targetSec / distanceKm;
  const slow = Math.max(0, slowSecPerKm);
  const timeAt = (x) =>
    x <= SLOW_START_KM
      ? x * (base + slow)
      : SLOW_START_KM * (base + slow) + (x - SLOW_START_KM) * base;

  const marks = [];
  for (let k = intervalKm; k < distanceKm - 1e-9; k += intervalKm) marks.push(k);
  marks.push(distanceKm);

  return marks.map((k) => ({
    label: `${formatKm(k)} km`,
    time: formatHms(timeAt(k)),
  }));
}

/**
 * Calcul complet à partir des valeurs brutes du formulaire.
 * Retourne { error, pace, splits } ; en cas d'erreur, pace et splits valent null.
 */
export function compute(saisie = {}) {
  const error = validate(saisie);
  if (error) return { error, pace: null, splits: null };

  const distanceKm = parseDistance(saisie.distance);
  const targetSec = parseChrono(saisie.chrono);
  const intervalKm = Number(saisie.repere);
  const slowSecPerKm = parseDepart(saisie.depart);

  return {
    error: null,
    pace: {
      paceLabel: formatPace(targetSec / distanceKm),
      speedLabel: formatSpeed(distanceKm / (targetSec / 3600)),
    },
    splits: computeSplits({ distanceKm, targetSec, intervalKm, slowSecPerKm }),
  };
}

// ---- Branchement à la page (uniquement dans un navigateur) ----
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const form = $("form-allure");
  const erreurEl = $("erreur");
  const resultatsEl = $("resultats");
  const allureEl = $("allure");
  const vitesseEl = $("vitesse");
  const passagesEl = $("passages");

  function afficher(r) {
    erreurEl.textContent = r.error ?? "";
    resultatsEl.hidden = r.error !== null;
    if (r.error) {
      allureEl.textContent = "";
      vitesseEl.textContent = "";
      passagesEl.replaceChildren();
      return;
    }
    allureEl.textContent = r.pace.paceLabel;
    vitesseEl.textContent = r.pace.speedLabel;
    passagesEl.replaceChildren(
      ...r.splits.map((ligne) => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = ligne.label;
        const td = document.createElement("td");
        td.textContent = ligne.time;
        tr.append(th, td);
        return tr;
      }),
    );
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    afficher(
      compute({
        distance: $("distance").value,
        chrono: $("chrono").value,
        repere: $("repere").value,
        depart: $("depart").value,
      }),
    );
  });

  resultatsEl.hidden = true;
}
