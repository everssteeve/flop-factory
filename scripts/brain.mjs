#!/usr/bin/env node
// Cerveau, côté agent : propose une amélioration des prompts de production et
// l'essaie sur une app de référence. Il ne décide de rien : le job records
// revalide la proposition, lit le verdict de la porte sur l'app d'essai, et
// seulement alors l'adopte (puis la surveille et la retire si les résultats baissent).
//
//   node scripts/brain.mjs <root-avec-données> <work-dir> <records-dir>
//
// Sortie ($GITHUB_OUTPUT) : brain = skip | proposed | failed, reason.
// Si proposed : <work-dir>/brain/out/{candidate/*.md, proposal.json, bench/…}.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, dayKey } from "./lib/budget.mjs";
import { loadIdeas } from "./lib/apps.mjs";
import { ZONE_NAMES, zonePrompt, checkPrompt, defaultPrompt, lineDiff } from "./lib/brain-zone.mjs";
import { digest } from "./lib/digest.mjs";
import { buildApp } from "./pipeline.mjs";
import { runAtelier } from "./run-atelier.mjs";

export function readBrainState(root) {
  const p = join(root, "factory", "brain", "state.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { lastProposalAt: null, current: null, history: [] };
}

/** Lignes ajoutées et retirées : la taille du changement. */
export function changedLines(before, after) {
  return lineDiff(before, after).total;
}

/** Faut-il proposer aujourd'hui ? Renvoie null si oui, sinon la raison. */
export function notDue({ config, state, dig, now }) {
  const b = config.brain;
  if (!b.enabled) return "cerveau désactivé";
  if (state.current?.status === "evaluating") return `version ${state.current.id} en évaluation`;
  if (state.lastProposalAt && dayKey(new Date(state.lastProposalAt), config.budget.timezone) === dayKey(now, config.budget.timezone)) return "déjà proposé aujourd'hui";
  if (dig.failures < b.minFailures) return `${dig.failures} échec(s) depuis la dernière proposition (minimum ${b.minFailures})`;
  if (!dig.motifs.length) return "aucun motif d'échec";
  return null;
}

export function runBrain({ root, work, records, now = new Date() }, deps = {}) {
  const run = deps.runAtelier ?? ((opts) => runAtelier(opts, { root }));
  const config = loadConfig(root);
  const state = readBrainState(root);
  const dig = digest(root, { since: state.lastProposalAt });
  const why = notDue({ config, state, dig, now });
  if (why) return { brain: "skip", reason: why };

  const base = join(work, "brain");
  rmSync(base, { recursive: true, force: true });
  const dir = join(base, "run");
  mkdirSync(dir, { recursive: true });
  const current = Object.fromEntries(ZONE_NAMES.map((n) => [n, zonePrompt(root, n)]));
  for (const n of ZONE_NAMES) writeFileSync(join(dir, `${n}.md`), current[n]);
  writeFileSync(join(dir, "digest.json"), JSON.stringify(dig, null, 2) + "\n");

  const r = run({ atelier: "cerveau", prompt: "factory/prompts/brain.md", workdir: dir, records, maxTurns: String(config.brain.maxTurns) });
  if (r.status !== "ok") return { brain: r.status === "no-budget" || r.status === "stopped" ? "skip" : "failed", reason: `run ${r.status}` };

  // Contrôles de code avant tout essai.
  const candidate = {};
  const problems = [];
  let lines = 0;
  for (const n of ZONE_NAMES) {
    const text = readFileSync(join(dir, `${n}.md`), "utf8");
    if (text === current[n]) continue;
    const p = checkPrompt(n, text, defaultPrompt(root, n), { current: current[n], maxChangedLines: config.brain.maxChangedLines });
    if (p.length) problems.push(`${n} : ${p.join(", ")}`);
    lines += changedLines(current[n], text);
    candidate[n] = text;
  }
  if (!Object.keys(candidate).length) return { brain: "failed", reason: "aucun prompt modifié" };
  if (lines > config.brain.maxChangedLines) problems.push(`changement trop large : ${lines} lignes au total (max ${config.brain.maxChangedLines})`);
  if (problems.length) return { brain: "failed", reason: problems.join(" ; ").slice(0, 500) };
  let proposal = null;
  try {
    proposal = JSON.parse(readFileSync(join(dir, "proposal.json"), "utf8"));
  } catch {}
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").slice(0, 300);
  proposal = { motif: clean(proposal?.motif), change: clean(proposal?.change), expected: clean(proposal?.expected), lines };

  // Essai : l'app de référence, construite par les modèles de production avec les prompts candidats.
  const idea = loadIdeas(root).find((i) => i.slug === config.brain.benchSlug);
  if (!idea) return { brain: "failed", reason: `app de référence inconnue : ${config.brain.benchSlug}` };
  const bench = buildApp({
    root,
    idea,
    states: {},
    work: base,
    records,
    run,
    config,
    prompts: candidate,
    tag: "bench-",
    ateliers: { build: "cerveau", qualite: "cerveau" },
    models: { build: config.models.byAtelier.build, qualite: config.models.byAtelier.qualite },
  });

  const out = join(base, "out");
  mkdirSync(join(out, "candidate"), { recursive: true });
  for (const [n, text] of Object.entries(candidate)) writeFileSync(join(out, "candidate", `${n}.md`), text);
  writeFileSync(join(out, "proposal.json"), JSON.stringify({ ...proposal, bench: { stage: bench.stage, reason: clean(bench.reason) } }, null, 2) + "\n");
  if (bench.stage === "done") cpSync(join(base, `bench-${idea.slug}`, "out"), join(out, "bench"), { recursive: true });
  return { brain: "proposed", reason: `${proposal.motif || "motif non précisé"} — essai : ${bench.stage}` };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [, work, records] = process.argv.slice(2);
  let out;
  try {
    out = runBrain({ root, work, records });
  } catch (e) {
    out = { brain: "failed", reason: `cerveau planté : ${e.message}` };
  }
  console.log(JSON.stringify(out));
  if (process.env.GITHUB_OUTPUT) {
    const bench = out.brain === "proposed" && existsSync(join(work, "brain", "out", "bench")) ? "yes" : "no";
    writeFileSync(process.env.GITHUB_OUTPUT, `brain=${out.brain}\nbench=${bench}\nbrain_reason=${String(out.reason).replace(/[\r\n]+/g, " ").slice(0, 400)}\n`, { flag: "a" });
  }
}
