// Tests sans dépendance : node test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createState, tick, toggleRunning, resetTimer, render,
  readCount, storageKey, dateKey, formatTime,
} from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");

const TODAY = "2026-10-17";
const YESTERDAY = "2026-10-16";
const TOMORROW = "2026-10-18";

function memStore(init = {}) {
  const data = { ...init };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

function check(cond, message) {
  if (!cond) throw new Error(message);
}

function htmlHasText(id, text) {
  const re = new RegExp(`id="${id}"[^>]*>${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`);
  return re.test(html);
}

function htmlHasElement(id) {
  return new RegExp(`id="${id}"`).test(html);
}

function ok(id) {
  console.log(`ok ${id}`);
}

try {
  // Garde-fous HTML communs (page sous CSP stricte).
  check(/<title>Minuteur Pomodoro<\/title>/.test(html), "titre attendu");
  check(/<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), "viewport attendu");
  check(/<link rel="stylesheet" href="style\.css">/.test(html), "lien style.css attendu");
  check(/<script type="module" src="app\.js"><\/script>/.test(html), "script module app.js attendu");
  check(!/<script(?![^>]*src=)/i.test(html), "script en ligne interdit");
  check(!/\sstyle="/i.test(html) && !/\sonclick="/i.test(html), "style ou handler en ligne interdit");
  check(!/https?:\/\/|localhost/i.test(html), "ressource externe ou localhost interdit");
  check(dateKey(new Date(2026, 9, 17)) === TODAY, "dateKey doit donner AAAA-MM-JJ local");
  check(formatTime(1500) === "25:00" && formatTime(300) === "05:00", "formatTime");

  // AC-1 : état initial
  {
    const store = memStore();
    const state = createState(store, TODAY);
    const view = render(state);
    check(view.timer === "25:00", `AC-1 timer=${view.timer}`);
    check(view.counter === "0 tranche aujourd'hui", `AC-1 compteur=${view.counter}`);
    check(htmlHasText("timer", "25:00"), "AC-1 HTML timer");
    check(htmlHasText("counter", "0 tranche aujourd'hui"), "AC-1 HTML compteur");
    ok("AC-1");
  }

  // AC-2 : fin de tranche -> pause courte et compteur 0 -> 1
  {
    const store = memStore();
    const start = { ...createState(store, TODAY), remaining: 1, running: true };
    const next = tick(start, store, TODAY);
    const view = render(next);
    check(next.phase === "short", `AC-2 phase=${next.phase}`);
    check(view.timer === "05:00", `AC-2 timer=${view.timer}`);
    check(next.count === 1 && readCount(store, TODAY) === 1, "AC-2 compteur 0 -> 1");
    check(htmlHasElement("timer") && htmlHasElement("counter") && htmlHasElement("phase"), "AC-2 éléments HTML présents");
    ok("AC-2");
  }

  // AC-3 : quatrième tranche -> pause longue 15:00
  {
    const store = memStore({ [storageKey(TODAY)]: "3" });
    const start = { ...createState(store, TODAY), remaining: 1, running: true };
    const next = tick(start, store, TODAY);
    check(next.count === 4, `AC-3 compteur=${next.count}`);
    check(next.phase === "long", `AC-3 phase=${next.phase}`);
    check(render(next).timer === "15:00", `AC-3 timer=${render(next).timer}`);

    // Enchaînement complet : les 3 premières pauses sont courtes, la 4e tranche donne une pause longue.
    const s2 = memStore();
    let s = createState(s2, TODAY);
    const phases = [];
    for (let i = 0; i < 4; i++) {
      s = { ...s, running: true, remaining: 1 };
      s = tick(s, s2, TODAY);
      phases.push(s.phase);
      s = { ...s, remaining: 1, running: true };
      s = tick(s, s2, TODAY); // fin de pause -> travail
    }
    check(phases.join(",") === "short,short,short,long", `AC-3 séquence=${phases}`);
    check(htmlHasElement("phase") && htmlHasElement("timer"), "AC-3 éléments HTML présents");
    ok("AC-3");
  }

  // AC-4 : pause pendant 10 secondes -> temps figé à 25:00
  {
    const store = memStore();
    let s = { ...createState(store, TODAY), remaining: 1500, running: true };
    s = toggleRunning(s);
    check(s.running === false, "AC-4 pause active");
    for (let i = 0; i < 10; i++) s = tick(s, store, TODAY);
    check(s.remaining === 1500, `AC-4 remaining=${s.remaining}`);
    check(render(s).timer === "25:00", `AC-4 timer=${render(s).timer}`);
    check(htmlHasText("timer", "25:00"), "AC-4 HTML timer initial");
    ok("AC-4");
  }

  // AC-5 : rechargement le même jour -> compteur conservé
  {
    const store = memStore({ [storageKey(TODAY)]: "3" });
    const state = createState(store, TODAY);
    check(render(state).counter === "3 tranches aujourd'hui", `AC-5 compteur=${render(state).counter}`);
    check(readCount(store, TODAY) === 3, "AC-5 valeur stockée conservée");
    check(htmlHasText("counter", "0 tranche aujourd'hui"), "AC-5 HTML (texte initial)");
    ok("AC-5");
  }

  // AC-6 : nouveau jour -> compteur à 0 et valeur du jour stockée à 0
  {
    const store = memStore({ [storageKey(YESTERDAY)]: "3" });
    const state = createState(store, TOMORROW);
    check(render(state).counter === "0 tranche aujourd'hui", `AC-6 compteur=${render(state).counter}`);
    check(store.getItem(storageKey(TOMORROW)) === "0", "AC-6 valeur stockée du jour = 0");
    check(store.getItem(storageKey(YESTERDAY)) === "3", "AC-6 la veille reste intacte");
    ok("AC-6");
  }

  // AC-7 : réinitialiser depuis l'état initial -> 25:00 travail, compteur inchangé
  {
    const store = memStore({ [storageKey(TODAY)]: "2" });
    const state = createState(store, TODAY);
    const s = resetTimer(state);
    const view = render(s);
    check(view.timer === "25:00", `AC-7 timer=${view.timer}`);
    check(s.phase === "work", "AC-7 mode travail");
    check(s.count === 2 && readCount(store, TODAY) === 2, "AC-7 compteur inchangé");
    // Réinitialiser en cours de tranche revient aussi à 25:00.
    const running = resetTimer({ ...s, remaining: 100, running: true });
    check(running.remaining === 1500 && running.running === false, "AC-7 reset en cours");
    ok("AC-7");
  }
} catch (err) {
  console.error(`échec : ${err.message}`);
  process.exit(1);
}
