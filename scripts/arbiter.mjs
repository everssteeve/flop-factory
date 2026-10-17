#!/usr/bin/env node
// Arbitre go / no-go. Du code, pas un modèle : la porte doit être passée, la
// revue sans défaut bloquant et au-dessus du seuil. Sinon l'idée est retentée
// au prochain passage (le modèle monte d'un cran après deux échecs), puis
// abandonnée après maxAttempts. Exécuté dans le job records, seul à écrire.
//
//   node scripts/arbiter.mjs <data-dir> --slug S --stage X --reason R [--verdict <dir>]
//
// <data-dir> : worktree de la branche data. <verdict> : sortie de la porte.
// Écrit factory/apps/<slug>.json et, si go, apps/<slug>/. Sortie : decision.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/budget.mjs";
import { loadIdeas, readStates, newState, validateSpec, SLUG } from "./lib/apps.mjs";
import { copyAccepted, NEVER_PUBLISHED } from "./lib/site-files.mjs";
import { normalizeReview } from "./pipeline.mjs";

const HISTORY = 20;

/** Décision pure à partir du verdict de la porte et de la revue. */
export function decide({ gate, review, config }) {
  const reasons = [];
  if (!gate) reasons.push("pas de verdict de la porte");
  else if (!gate.passed) reasons.push(...gate.problems.map((p) => `porte : ${p}`));
  if (review) {
    reasons.push(...review.blocking.map((b) => `revue : ${b}`));
    if (review.score < config.pipeline.reviewMinScore) reasons.push(`revue : score ${review.score} < ${config.pipeline.reviewMinScore}`);
  } else reasons.push("pas de revue");
  return { go: reasons.length === 0, reasons };
}

/** Nouvel état d'une app après un passage. */
export function nextState(state, { go, reasons }, config, now, spec) {
  const s = structuredClone(state);
  if (s.status !== "building") throw new Error(`${s.slug} n'est pas en construction (${s.status})`);
  s.attempts += 1;
  let decision;
  if (go) {
    s.status = "live";
    s.liveSince = now.toISOString();
    s.spec = spec;
    decision = "go";
  } else if (s.attempts >= config.pipeline.maxAttempts) {
    s.status = "abandoned";
    decision = "abandon";
  } else decision = "retry";
  s.history = [...s.history, { at: now.toISOString(), decision, reasons: reasons.slice(0, 10).map((r) => String(r).slice(0, 300)) }].slice(-HISTORY);
  return { state: s, decision };
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function arbitrate({ root, data, slug, stage, reason, verdict, now = new Date() }) {
  const config = loadConfig(root);
  // Arrêt, budget épuisé ou rien à construire : aucune tentative consommée.
  if (!["spec", "build", "done"].includes(stage)) return { decision: "skip", reasons: [`étape ${stage}`], attempts: null };
  if (!SLUG.test(slug ?? "")) throw new Error(`slug invalide : ${slug}`);
  const idea = loadIdeas(root).find((i) => i.slug === slug);
  if (!idea) throw new Error(`app inconnue : ${slug}`);
  const state = readStates(data)[slug] ?? newState(slug);

  let gate = null;
  let review = null;
  let spec = null;
  if (stage === "done" && verdict && existsSync(join(verdict, "gate.json"))) {
    gate = JSON.parse(readFileSync(join(verdict, "gate.json"), "utf8"));
    if (gate.slug !== slug) throw new Error(`verdict pour ${gate.slug}, attendu ${slug}`);
    review = normalizeReview(JSON.parse(readFileSync(join(verdict, "review.json"), "utf8")));
    spec = JSON.parse(readFileSync(join(verdict, "spec.json"), "utf8"));
    if (validateSpec(spec, idea, config).length) gate = { ...gate, passed: false, problems: [...gate.problems, "spec invalide"] };
  }
  const verdictDecision =
    stage === "done" ? decide({ gate, review, config }) : { go: false, reasons: [`atelier ${stage} : ${String(reason ?? "échec").slice(0, 300)}`] };

  const { state: next, decision } = nextState(state, verdictDecision, config, now, spec);
  if (decision === "go") {
    const dest = join(data, "apps", slug);
    rmSync(dest, { recursive: true, force: true });
    const { problems } = copyAccepted(join(verdict, "site"), dest, config.pipeline, NEVER_PUBLISHED);
    if (problems.length) throw new Error(`site refusé à la copie : ${problems.join(" ; ")}`);
  }
  const p = join(data, "factory", "apps", `${slug}.json`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n");
  return { decision, reasons: verdictDecision.reasons, attempts: next.attempts };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const argv = process.argv.slice(2);
  const verdict = arg(argv, "verdict");
  const out = arbitrate({
    root,
    data: resolve(argv[0]),
    slug: arg(argv, "slug"),
    stage: arg(argv, "stage"),
    reason: arg(argv, "reason"),
    verdict: verdict ? resolve(verdict) : undefined,
  });
  console.log(JSON.stringify(out));
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `decision=${out.decision}\n`, { flag: "a" });
}
