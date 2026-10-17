import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, nextState, arbitrate } from "../scripts/arbiter.mjs";
import { assemble, injectFooter } from "../scripts/assemble-site.mjs";
import { newState } from "../scripts/lib/apps.mjs";
import { loadConfig } from "../scripts/lib/budget.mjs";

const repo = join(import.meta.dirname, "..");
const FIXTURE = join(import.meta.dirname, "fixtures", "good-app");
const config = loadConfig(repo);
const NOW = new Date("2026-10-18T05:30:00Z");
const PASS = { slug: "tirage-equipes", passed: true, problems: [] };
const GOOD = { score: 8, blocking: [], notes: [] };

test("go seulement si porte passée, revue sans blocage et au-dessus du seuil", () => {
  assert.deepEqual(decide({ gate: PASS, review: GOOD, config }), { go: true, reasons: [] });
  assert.equal(decide({ gate: { ...PASS, passed: false, problems: ["x"] }, review: GOOD, config }).go, false);
  assert.equal(decide({ gate: PASS, review: { ...GOOD, blocking: ["AC-2 non testé"] }, config }).go, false);
  assert.equal(decide({ gate: PASS, review: { ...GOOD, score: config.pipeline.reviewMinScore - 1 }, config }).go, false);
  assert.equal(decide({ gate: null, review: GOOD, config }).go, false);
  assert.equal(decide({ gate: PASS, review: null, config }).go, false);
});

test("un verdict mal formé n'est jamais un go", () => {
  assert.equal(decide({ gate: { ...PASS, passed: "false" }, review: GOOD, config }).go, false);
  assert.equal(decide({ gate: { ...PASS, passed: 1 }, review: GOOD, config }).go, false);
  assert.equal(decide({ gate: { slug: "x", passed: true }, review: GOOD, config }).go, false);
});

test("panne d'infrastructure : aucune tentative consommée", () => {
  const data = mkdtempSync(join(tmpdir(), "ff-data-"));
  assert.equal(arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "infra", now: NOW }).decision, "skip");
  const v = verdictDir({ gate: { ...PASS, passed: false, infra: true, problems: ["test.mjs : sandbox indisponible"] } });
  assert.equal(arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "done", verdict: v, now: NOW }).decision, "skip");
  assert.equal(existsSync(join(data, "factory", "apps", "tirage-equipes.json")), false);
  assert.equal(arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "error", reason: "plantage", now: NOW }).decision, "retry");
});

test("une revue ne peut pas imposer une app refusée par la porte", () => {
  const d = decide({ gate: { ...PASS, passed: false, problems: ["test.mjs échoue"] }, review: { score: 10, blocking: [], notes: [] }, config });
  assert.equal(d.go, false);
  assert.deepEqual(d.reasons, ["porte : test.mjs échoue"]);
});

test("transitions : retry puis abandon à maxAttempts, go met en ligne", () => {
  let s = newState("x");
  for (let i = 1; i < config.pipeline.maxAttempts; i++) {
    const r = nextState(s, { go: false, reasons: ["r"] }, config, NOW);
    assert.equal(r.decision, "retry");
    s = r.state;
  }
  const last = nextState(s, { go: false, reasons: ["r"] }, config, NOW);
  assert.equal(last.decision, "abandon");
  assert.equal(last.state.status, "abandoned");
  assert.throws(() => nextState(last.state, { go: true, reasons: [] }, config, NOW), /pas en construction/);
  const live = nextState(newState("x"), { go: true, reasons: [] }, config, NOW, { name: "X" });
  assert.equal(live.state.status, "live");
  assert.equal(live.state.liveSince, NOW.toISOString());
  assert.equal(live.state.history.length, 1);
});

function verdictDir({ gate = PASS, review = GOOD, spec } = {}) {
  const v = mkdtempSync(join(tmpdir(), "ff-v-"));
  mkdirSync(join(v, "site"));
  for (const f of ["index.html", "style.css", "app.js", "test.mjs"]) cpSync(join(FIXTURE, f), join(v, "site", f));
  writeFileSync(join(v, "gate.json"), JSON.stringify(gate));
  writeFileSync(join(v, "review.json"), JSON.stringify(review));
  writeFileSync(join(v, "spec.json"), spec ?? readFileSync(join(FIXTURE, "spec.json"), "utf8"));
  return v;
}

test("arbitrage go : app copiée sur data, état en ligne avec sa spec", () => {
  const data = mkdtempSync(join(tmpdir(), "ff-data-"));
  const out = arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "done", verdict: verdictDir(), now: NOW });
  assert.equal(out.decision, "go");
  assert.ok(existsSync(join(data, "apps", "tirage-equipes", "index.html")));
  const state = JSON.parse(readFileSync(join(data, "factory", "apps", "tirage-equipes.json"), "utf8"));
  assert.equal(state.status, "live");
  assert.equal(state.spec.name, "Tirage d'équipes");
});

test("arbitrage : échec d'atelier compté, arrêt et budget non comptés", () => {
  const data = mkdtempSync(join(tmpdir(), "ff-data-"));
  assert.equal(arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "no-budget", now: NOW }).decision, "skip");
  assert.equal(existsSync(join(data, "factory", "apps", "tirage-equipes.json")), false);
  const r = arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "spec", reason: "spec refusée", now: NOW });
  assert.equal(r.decision, "retry");
  assert.equal(r.attempts, 1);
});

test("arbitrage : verdict d'une autre app, slug inconnu ou spec trafiquée refusés", () => {
  const data = mkdtempSync(join(tmpdir(), "ff-data-"));
  assert.throws(() => arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "done", verdict: verdictDir({ gate: { ...PASS, slug: "autre" } }) }), /verdict pour autre/);
  assert.throws(() => arbitrate({ root: repo, data, slug: "../etc", stage: "spec" }), /slug invalide/);
  assert.throws(() => arbitrate({ root: repo, data, slug: "inconnue", stage: "spec" }), /app inconnue/);
  const bad = JSON.stringify({ ...JSON.parse(readFileSync(join(FIXTURE, "spec.json"), "utf8")), name: "<script>" + "x".repeat(50) });
  assert.equal(arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "done", verdict: verdictDir({ spec: bad }) }).decision, "retry");
});

test("catalogue : apps en ligne, pied de page légal, textes échappés", async () => {
  const data = mkdtempSync(join(tmpdir(), "ff-data-"));
  arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "done", verdict: verdictDir(), now: NOW });
  // Une spec en ligne au nom piégé reste du texte.
  const p = join(data, "factory", "apps", "tirage-equipes.json");
  const s = JSON.parse(readFileSync(p, "utf8"));
  s.spec.pitch = '<img src=x onerror="alert(1)">';
  writeFileSync(p, JSON.stringify(s));
  const out = join(mkdtempSync(join(tmpdir(), "ff-pub-")), "public");
  assert.deepEqual(assemble(repo, data, out), ["tirage-equipes"]);
  const index = readFileSync(join(out, "index.html"), "utf8");
  assert.ok(index.includes('href="apps/tirage-equipes/"'));
  assert.ok(index.includes("&lt;img src=x"));
  assert.ok(!index.includes("<img src=x"));
  const appPage = readFileSync(join(out, "apps", "tirage-equipes", "index.html"), "utf8");
  assert.ok(appPage.includes('class="ff-legal"'));
  assert.ok(appPage.includes("Steeve Evers"));
  assert.ok(readFileSync(join(out, "mentions-legales.html"), "utf8").includes("GitHub, Inc."));
  const { hasFactoryCsp } = await import("../scripts/lib/harden.mjs");
  for (const f of ["index.html", "mentions-legales.html", "apps/tirage-equipes/index.html"]) assert.ok(hasFactoryCsp(readFileSync(join(out, f), "utf8")), f);
  assert.ok(!appPage.includes("<style>"), "aucun style en ligne, interdit par la politique");
  assert.ok(existsSync(join(out, "ff-legal.css")));
  assert.equal(existsSync(join(out, "apps", "tirage-equipes", "test.mjs")), false);
});

test("pied de page inséré avant le dernier </body>", () => {
  assert.equal(injectFooter("<body>a</body>x</body>", "F"), "<body>a</body>xF</body>");
  assert.equal(injectFooter("<p>sans body</p>", "F"), "<p>sans body</p>F");
  assert.equal(injectFooter("<body></body>", "$&$'"), "<body>$&$'</body>");
});
