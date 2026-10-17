// Minuteur Pomodoro : logique pure (testable sous Node) + branchement à la page.

export const WORK_SECONDS = 25 * 60;
export const SHORT_BREAK_SECONDS = 5 * 60;
export const LONG_BREAK_SECONDS = 15 * 60;
export const LONG_BREAK_EVERY = 4;
export const STORAGE_PREFIX = "pomodoro:tranches:";

const PHASE_LABELS = { work: "Travail", short: "Pause courte", long: "Pause longue" };

/** Formate un nombre de secondes en MM:SS. */
export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Clé de jour locale au format AAAA-MM-JJ. */
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function storageKey(day) {
  return STORAGE_PREFIX + day;
}

/** Lit le compteur d'un jour dans le stockage (0 si absent ou invalide). */
export function readCount(store, day) {
  const n = parseInt(store.getItem(storageKey(day)), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function writeCount(store, day, count) {
  store.setItem(storageKey(day), String(count));
}

/** Charge le compteur du jour et écrit sa valeur (0 pour un nouveau jour). */
export function restoreCount(store, day) {
  const count = readCount(store, day);
  writeCount(store, day, count);
  return count;
}

export function phaseDuration(phase) {
  if (phase === "short") return SHORT_BREAK_SECONDS;
  if (phase === "long") return LONG_BREAK_SECONDS;
  return WORK_SECONDS;
}

/** Pause après la tranche n° count de la journée : longue tous les 4 tranches. */
export function breakPhaseAfter(count) {
  return count > 0 && count % LONG_BREAK_EVERY === 0 ? "long" : "short";
}

/** État initial pour un jour donné ; le compteur vient du stockage. */
export function createState(store, day) {
  return {
    day,
    count: restoreCount(store, day),
    phase: "work",
    remaining: WORK_SECONDS,
    running: false,
  };
}

/** Si le jour a changé, recharge le compteur du nouveau jour. */
export function syncDay(state, store, day) {
  if (state.day === day) return state;
  return { ...state, day, count: restoreCount(store, day) };
}

function endPhase(state, store) {
  if (state.phase === "work") {
    const count = state.count + 1;
    writeCount(store, state.day, count);
    const phase = breakPhaseAfter(count);
    // La pause démarre automatiquement.
    return { ...state, count, phase, remaining: phaseDuration(phase), running: true };
  }
  // Fin de pause : retour au travail, qui attend un démarrage explicite.
  return { ...state, phase: "work", remaining: WORK_SECONDS, running: false };
}

/** Avance d'une seconde si le minuteur tourne ; gère la fin de phase. */
export function tick(state, store, day) {
  if (!state.running) return state;
  const current = syncDay(state, store, day);
  const remaining = current.remaining - 1;
  if (remaining > 0) return { ...current, remaining };
  return endPhase(current, store);
}

export function toggleRunning(state) {
  return { ...state, running: !state.running };
}

/** Revient au travail, 25:00, sans toucher au compteur du jour. */
export function resetTimer(state) {
  return { ...state, phase: "work", remaining: WORK_SECONDS, running: false };
}

export function counterText(count) {
  return `${count} tranche${count > 1 ? "s" : ""} aujourd'hui`;
}

export function buttonLabel(state) {
  if (state.running) return "Mettre en pause";
  if (state.remaining < phaseDuration(state.phase)) return "Reprendre";
  return "Démarrer";
}

/** Textes et classes à afficher pour un état. Ne touche pas au DOM. */
export function render(state) {
  return {
    timer: formatTime(state.remaining),
    phase: PHASE_LABELS[state.phase] || PHASE_LABELS.work,
    phaseClass: `phase-${state.phase}`,
    counter: counterText(state.count),
    button: buttonLabel(state),
  };
}

// ---------- Branchement à la page ----------

if (typeof document !== "undefined") {
  const byId = (id) => document.getElementById(id);

  function safeStorage() {
    try {
      const ls = window.localStorage;
      ls.getItem("__probe__");
      return ls;
    } catch (e) {
      const mem = {};
      return {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
      };
    }
  }

  let audioCtx = null;
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.12;
      osc.frequency.value = 660;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
      // Son indisponible : le minuteur continue sans son.
    }
  }

  const store = safeStorage();
  const els = {
    timer: byId("timer"),
    phase: byId("phase"),
    counter: byId("counter"),
    startPause: byId("start-pause"),
    reset: byId("reset"),
  };
  let state = createState(store, dateKey(new Date()));

  function draw() {
    const view = render(state);
    els.timer.textContent = view.timer;
    els.phase.textContent = view.phase;
    els.timer.className = `timer ${view.phaseClass}`;
    els.counter.textContent = view.counter;
    els.startPause.textContent = view.button;
  }

  els.startPause.addEventListener("click", () => {
    state = toggleRunning(state);
    draw();
  });

  els.reset.addEventListener("click", () => {
    state = resetTimer(state);
    draw();
  });

  setInterval(() => {
    const previousPhase = state.phase;
    state = tick(state, store, dateKey(new Date()));
    if (state.phase !== previousPhase) beep();
    draw();
  }, 1000);

  draw();
}
