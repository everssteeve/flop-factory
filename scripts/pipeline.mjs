#!/usr/bin/env node
// Chaîne de build d'une app, côté agent : idée → spec → build → revue.
// Chaque étape est un run borné (run-atelier) dans son propre dossier ; entre
// deux étapes, seul du code de l'usine fait passer les fichiers, après contrôle.
// Rien ici ne décide de la publication : la porte et l'arbitre le font dans un
// autre job, sur un checkout neuf.
//
//   node scripts/pipeline.mjs <state-dir> <work-dir> <records-dir>
//
// <state-dir> : où lire factory/apps (copie de la branche data).
// Sorties ($GITHUB_OUTPUT) : slug, stage = none | stopped | no-budget | spec | build | done,
// reason. Le dossier <work-dir>/<slug>/out contient l'app, la spec validée et la revue.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/budget.mjs";
import { loadIdeas, readStates, pickIdea, validateSpec } from "./lib/apps.mjs";
import { copyAccepted, NEVER_PUBLISHED, WORKDIR_PACKAGE } from "./lib/site-files.mjs";
import { runAtelier } from "./run-atelier.mjs";

export function render(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`variable de prompt inconnue : ${k}`);
    return String(vars[k]);
  });
}

function writePrompt(root, name, text) {
  const rel = join("dist", "prompts", `${name}.md`);
  mkdirSync(join(root, "dist", "prompts"), { recursive: true });
  writeFileSync(join(root, rel), text);
  return rel;
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Ramène une revue à sa forme stricte ; une revue absente ou douteuse bloque. */
export function normalizeReview(raw) {
  if (!raw || typeof raw !== "object") return { score: 0, blocking: ["revue absente ou illisible"], notes: [] };
  const score = Number.isInteger(raw.score) && raw.score >= 0 && raw.score <= 10 ? raw.score : 0;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, 20) : []);
  const blocking = list(raw.blocking);
  if (score === 0 && !blocking.length) blocking.push("score de revue absent ou invalide");
  return { score, blocking, notes: list(raw.notes) };
}

export function runPipeline({ root, stateDir, work, records }, deps = {}) {
  const run = deps.runAtelier ?? ((opts) => runAtelier(opts, { root, ...deps.atelierEnv }));
  const config = loadConfig(root);
  const limits = config.pipeline;
  const states = readStates(stateDir);
  const idea = pickIdea(loadIdeas(root), states, limits.maxAttempts);
  if (!idea) return { stage: "none", reason: "aucune idée à construire" };
  // Une app déjà refusée escalateAfterFailures fois passe au modèle d'escalade
  // pour la spec et le build, même si ses runs s'étaient dits « ok ».
  const attempts = states[idea.slug]?.attempts ?? 0;
  const model = attempts >= config.models.escalateAfterFailures ? config.models.escalation : undefined;

  const base = join(work, idea.slug);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const stop = (stage, outcome, reason) => ({ slug: idea.slug, stage, reason: reason ?? `run ${outcome.status}`, runId: outcome?.runId });
  const halted = (o) => o.status === "stopped" || o.status === "no-budget";

  // 1. Spec
  const specPrompt = writePrompt(
    root,
    `spec-${idea.slug}`,
    render(readFileSync(join(root, "factory", "prompts", "spec.md"), "utf8"), {
      SLUG: idea.slug,
      IDEA: idea.idea,
      MAX_FEATURES: limits.maxFeatures,
      MAX_ACCEPTANCE: limits.maxAcceptance,
    }),
  );
  const specDir = join(base, "spec");
  const s = run({ atelier: "build", prompt: specPrompt, workdir: specDir, records, model, maxTurns: String(limits.specMaxTurns) });
  if (halted(s)) return { slug: idea.slug, stage: s.status, reason: s.status };
  if (s.status !== "ok") return stop("spec", s);
  const spec = readJson(join(specDir, "spec.json"));
  const specProblems = validateSpec(spec, idea, config);
  if (specProblems.length) return stop("spec", s, `spec refusée : ${specProblems.join(" ; ")}`);
  const specText = JSON.stringify(spec, null, 2);
  writeFileSync(join(base, "spec.json"), specText + "\n");

  // 2. Build
  const appDir = join(base, "app");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "spec.json"), specText + "\n");
  writeFileSync(join(appDir, "package.json"), WORKDIR_PACKAGE);
  const buildPrompt = writePrompt(root, `build-${idea.slug}`, render(readFileSync(join(root, "factory", "prompts", "build.md"), "utf8"), { SPEC: specText }));
  const b = run({ atelier: "build", prompt: buildPrompt, workdir: appDir, records, model, maxTurns: String(limits.buildMaxTurns) });
  if (halted(b)) return { slug: idea.slug, stage: b.status, reason: b.status };
  if (b.status !== "ok") return stop("build", b);

  // 3. Revue, sur une copie : l'agent de revue ne voit que les fichiers acceptés.
  const reviewDir = join(base, "review");
  const copy = copyAccepted(appDir, reviewDir, limits, NEVER_PUBLISHED);
  if (copy.problems.length) return stop("build", b, copy.problems.join(" ; "));
  writeFileSync(join(reviewDir, "spec.json"), specText + "\n");
  writeFileSync(join(reviewDir, "package.json"), WORKDIR_PACKAGE);
  const r = run({ atelier: "qualite", prompt: "factory/prompts/review.md", workdir: reviewDir, records, maxTurns: String(limits.reviewMaxTurns) });
  // Revue sans budget ou arrêtée : pas de verdict aujourd'hui, aucune tentative comptée.
  if (halted(r)) return { slug: idea.slug, stage: r.status, reason: `revue : ${r.status}` };
  // Revue ratée : l'app part quand même à la porte, avec une revue bloquante.
  const review = normalizeReview(r.status === "ok" ? readJson(join(reviewDir, "review.json")) : null);

  // 4. Sortie : app acceptée + spec validée + revue normalisée.
  const out = join(base, "out");
  const final = copyAccepted(appDir, out, limits, NEVER_PUBLISHED);
  if (final.problems.length) return stop("build", b, `fichiers modifiés après la revue : ${final.problems.join(" ; ")}`);
  writeFileSync(join(out, "spec.json"), specText + "\n");
  writeFileSync(join(out, "review.json"), JSON.stringify(review, null, 2) + "\n");
  return { slug: idea.slug, stage: "done", reason: review.blocking.length ? "revue bloquante" : "prête pour la porte", runId: b.runId };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [stateDir = root, work = join(root, "work"), records] = process.argv.slice(2);
  let outcome;
  try {
    outcome = runPipeline({ root, stateDir, work, records });
  } catch (e) {
    // Toujours écrire une sortie : sinon des lignes laissées par un agent dans $GITHUB_OUTPUT feraient foi.
    let slug = "";
    try {
      slug = pickIdea(loadIdeas(root), readStates(stateDir), loadConfig(root).pipeline.maxAttempts)?.slug ?? "";
    } catch {}
    outcome = { slug, stage: "error", reason: `chaîne plantée : ${e.message}` };
    process.exitCode = 1;
  }
  console.log(JSON.stringify(outcome));
  if (process.env.GITHUB_OUTPUT) {
    const reason = String(outcome.reason ?? "").replace(/[\r\n]+/g, " ").slice(0, 500);
    writeFileSync(process.env.GITHUB_OUTPUT, `slug=${outcome.slug ?? ""}\nstage=${outcome.stage}\nreason=${reason}\n`, { flag: "a" });
  }
  if (!existsSync(work)) mkdirSync(work, { recursive: true });
}
