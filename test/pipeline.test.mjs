import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline, render, normalizeReview } from "../scripts/pipeline.mjs";
import { validateSpec, pickIdea, loadIdeas, escapeHtml } from "../scripts/lib/apps.mjs";
import { loadConfig } from "../scripts/lib/budget.mjs";

const repo = join(import.meta.dirname, "..");
const FIXTURE = join(import.meta.dirname, "fixtures", "good-app");
const config = loadConfig(repo);
const SPEC = JSON.parse(readFileSync(join(FIXTURE, "spec.json"), "utf8"));
const IDEA = { slug: "tirage-equipes", idea: "x".repeat(30) };

test("les idées du dépôt sont valides et ordonnées", () => {
  const ideas = loadIdeas(repo);
  assert.ok(ideas.length >= 3);
  assert.equal(pickIdea(ideas, {}, 3).slug, ideas[0].slug);
});

test("choix de l'idée : saute les apps en ligne, abandonnées ou à court de tentatives", () => {
  const ideas = [{ slug: "a" }, { slug: "b" }, { slug: "c" }, { slug: "d" }];
  const states = {
    a: { status: "live", attempts: 1 },
    b: { status: "abandoned", attempts: 3 },
    c: { status: "building", attempts: 3 },
  };
  assert.equal(pickIdea(ideas, states, 3).slug, "d");
  assert.equal(pickIdea(ideas, { ...states, c: { status: "building", attempts: 1 } }, 3).slug, "c");
  assert.equal(pickIdea(ideas.slice(0, 3), states, 3), null);
});

test("spec : la spec de référence est acceptée", () => {
  assert.deepEqual(validateSpec(SPEC, IDEA, config), []);
});

test("spec : slug, champs, critères et longueurs contrôlés", () => {
  const p = (s) => validateSpec(s, IDEA, config);
  assert.ok(p({ ...SPEC, slug: "autre" })[0].includes("au lieu de tirage-equipes"));
  assert.ok(p({ ...SPEC, admin: true }).includes("champ inattendu : admin"));
  assert.ok(p({ ...SPEC, pitch: "x".repeat(200) }).includes("pitch : 10 à 160 caractères"));
  assert.ok(p({ ...SPEC, features: Array(9).fill("une fonction") }).some((m) => m.startsWith("features")));
  assert.ok(p({ ...SPEC, acceptance: [SPEC.acceptance[0]] }).some((m) => m.startsWith("acceptance")));
  const dup = [SPEC.acceptance[0], { ...SPEC.acceptance[1], id: "AC-1" }];
  assert.ok(p({ ...SPEC, acceptance: dup }).some((m) => m.includes("en double")));
  const extra = [SPEC.acceptance[0], { ...SPEC.acceptance[1], run: "rm -rf /" }];
  assert.ok(p({ ...SPEC, acceptance: extra }).some((m) => m.includes("champs inattendus")));
  assert.deepEqual(validateSpec("pas un objet", IDEA, config), ["spec illisible"]);
});

test("rendu des prompts : variables connues seulement", () => {
  assert.equal(render("a {{X}} b", { X: 1 }), "a 1 b");
  assert.throws(() => render("{{Y}}", {}), /inconnue/);
});

test("revue normalisée : absente, hors bornes ou bavarde → bloquante ou tronquée", () => {
  assert.deepEqual(normalizeReview(null).blocking, ["revue absente ou illisible"]);
  assert.equal(normalizeReview({ score: 42, blocking: [] }).score, 0);
  assert.deepEqual(normalizeReview({ score: 11 }).blocking, ["score de revue absent ou invalide"]);
  assert.deepEqual(normalizeReview({ score: 8, blocking: [1, "vrai défaut"], notes: ["n"] }), { score: 8, blocking: ["vrai défaut"], notes: ["n"] });
  assert.equal(normalizeReview({ score: 7, notes: ["x".repeat(999)] }).notes[0].length, 300);
});

test("échappement des textes de spec", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a">'&`), "&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;");
});

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "ff-pipe-"));
  for (const p of ["factory/config.json", "factory/ideas.json", "factory/prompts/spec.md", "factory/prompts/build.md", "factory/prompts/review.md"]) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    cpSync(join(repo, p), join(root, p));
  }
  writeFileSync(join(root, "factory", "ideas.json"), JSON.stringify({ ideas: [IDEA] }));
  return root;
}

/** Faux ateliers : chaque étape écrit ce qu'un agent écrirait. */
function fakeAteliers({ spec = SPEC, review = { score: 8, blocking: [] }, fail = {}, extraFile } = {}) {
  const calls = [];
  const run = (opts) => {
    calls.push(opts);
    const kind = opts.prompt.includes("spec-") ? "spec" : opts.prompt.includes("build-") ? "build" : "review";
    mkdirSync(opts.workdir, { recursive: true });
    if (fail[kind]) return { status: fail[kind], runId: `${kind}-1` };
    if (kind === "spec") writeFileSync(join(opts.workdir, "spec.json"), JSON.stringify(spec));
    if (kind === "build") {
      for (const f of ["index.html", "style.css", "app.js", "test.mjs"]) cpSync(join(FIXTURE, f), join(opts.workdir, f));
      writeFileSync(join(opts.workdir, "report.json"), '{"status":"ok"}');
      if (extraFile) writeFileSync(join(opts.workdir, extraFile), "x");
    }
    if (kind === "review") writeFileSync(join(opts.workdir, "review.json"), JSON.stringify(review));
    return { status: "ok", runId: `${kind}-1` };
  };
  return { run, calls };
}

test("chaîne complète : spec, build, revue sur copie, sortie propre", () => {
  const root = tempRoot();
  const work = mkdtempSync(join(tmpdir(), "ff-work-"));
  const fake = fakeAteliers();
  const out = runPipeline({ root, stateDir: root, work, records: "/r" }, { runAtelier: fake.run });
  assert.equal(out.stage, "done");
  assert.deepEqual(fake.calls.map((c) => c.atelier), ["build", "build", "qualite"]);
  assert.ok(fake.calls.every((c) => c.records === "/r"));
  // La spec validée est rendue dans le prompt de build.
  assert.ok(readFileSync(join(root, fake.calls[1].prompt), "utf8").includes('"slug": "tirage-equipes"'));
  // L'usine pose un package.json valide avant que la sandbox ne crée le sien, vide.
  assert.equal(JSON.parse(readFileSync(join(work, "tirage-equipes", "app", "package.json"), "utf8")).type, "module");
  assert.equal(JSON.parse(readFileSync(join(work, "tirage-equipes", "review", "package.json"), "utf8")).type, "module");
  // La revue travaille sur une copie sans rapport de l'agent de build.
  assert.equal(existsSync(join(work, "tirage-equipes", "review", "report.json")), false);
  const files = readdirSync(join(work, "tirage-equipes", "out")).sort();
  assert.deepEqual(files, ["app.js", "index.html", "review.json", "spec.json", "style.css", "test.mjs"]);
});

test("chaîne : une spec invalide arrête tout avant le build", () => {
  const root = tempRoot();
  const fake = fakeAteliers({ spec: { ...SPEC, slug: "autre" } });
  const out = runPipeline({ root, stateDir: root, work: mkdtempSync(join(tmpdir(), "ff-work-")) }, { runAtelier: fake.run });
  assert.equal(out.stage, "spec");
  assert.match(out.reason, /spec refusée/);
  assert.equal(fake.calls.length, 1);
});

test("chaîne : budget épuisé ou arrêt d'urgence ne comptent pas comme un échec", () => {
  const root = tempRoot();
  const out = runPipeline({ root, stateDir: root, work: mkdtempSync(join(tmpdir(), "ff-work-")) }, { runAtelier: fakeAteliers({ fail: { build: "no-budget" } }).run });
  assert.equal(out.stage, "no-budget");
});

test("chaîne : build raté ou fichier interdit → étape build en échec", () => {
  const root = tempRoot();
  const w = () => mkdtempSync(join(tmpdir(), "ff-work-"));
  assert.equal(runPipeline({ root, stateDir: root, work: w() }, { runAtelier: fakeAteliers({ fail: { build: "failed" } }).run }).stage, "build");
  const out = runPipeline({ root, stateDir: root, work: w() }, { runAtelier: fakeAteliers({ extraFile: "payload.sh" }).run });
  assert.equal(out.stage, "build");
  assert.match(out.reason, /extension refusée : payload\.sh/);
});

test("chaîne : revue ratée → l'app part à la porte avec une revue bloquante", () => {
  const root = tempRoot();
  const work = mkdtempSync(join(tmpdir(), "ff-work-"));
  const out = runPipeline({ root, stateDir: root, work }, { runAtelier: fakeAteliers({ fail: { review: "failed" } }).run });
  assert.equal(out.stage, "done");
  const review = JSON.parse(readFileSync(join(work, "tirage-equipes", "out", "review.json"), "utf8"));
  assert.deepEqual(review.blocking, ["revue absente ou illisible"]);
});

test("chaîne : revue sans budget → pas de verdict, aucune tentative comptée", () => {
  const root = tempRoot();
  const out = runPipeline({ root, stateDir: root, work: mkdtempSync(join(tmpdir(), "ff-work-")) }, { runAtelier: fakeAteliers({ fail: { review: "no-budget" } }).run });
  assert.equal(out.stage, "no-budget");
});

test("chaîne : après escalateAfterFailures refus, spec et build passent au modèle d'escalade", () => {
  const root = tempRoot();
  mkdirSync(join(root, "factory", "apps"), { recursive: true });
  const state = (attempts) => writeFileSync(join(root, "factory", "apps", "tirage-equipes.json"), JSON.stringify({ slug: "tirage-equipes", status: "building", attempts, history: [] }));
  state(config.models.escalateAfterFailures - 1);
  let fake = fakeAteliers();
  runPipeline({ root, stateDir: root, work: mkdtempSync(join(tmpdir(), "ff-work-")) }, { runAtelier: fake.run });
  assert.deepEqual(fake.calls.map((c) => c.model), [undefined, undefined, undefined]);
  state(config.models.escalateAfterFailures);
  fake = fakeAteliers();
  runPipeline({ root, stateDir: root, work: mkdtempSync(join(tmpdir(), "ff-work-")) }, { runAtelier: fake.run });
  assert.deepEqual(fake.calls.map((c) => c.model), [config.models.escalation, config.models.escalation, undefined]);
});

test("chaîne : plus rien à construire", () => {
  const root = tempRoot();
  mkdirSync(join(root, "factory", "apps"), { recursive: true });
  writeFileSync(join(root, "factory", "apps", "tirage-equipes.json"), JSON.stringify({ slug: "tirage-equipes", status: "live", attempts: 1 }));
  assert.equal(runPipeline({ root, stateDir: root, work: "/nope" }, { runAtelier: () => assert.fail() }).stage, "none");
});
