#!/usr/bin/env node
// Cerveau, côté records (seul job qui écrit) :
//   1. Évalue la version de prompts en cours : après evalWindow décisions, si le
//      taux de go est tombé de plus de `tolerance` sous la référence, elle est
//      retirée (les prompts d'avant sont restaurés) ; sinon elle est gardée.
//   2. Adopte une nouvelle proposition seulement si elle repasse les contrôles
//      de code et si l'app d'essai a passé la porte et la revue (même règle que
//      l'arbitre). Une seule version en évaluation à la fois.
//
//   node scripts/brain-records.mjs <data-dir> --proposed yes|no [--brain <dir>] [--verdict <dir>]

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, cpSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadConfig } from "./lib/budget.mjs";
import { ZONE_NAMES, checkPrompt, defaultPrompt } from "./lib/brain-zone.mjs";
import { decisions, goRate } from "./lib/digest.mjs";
import { decide } from "./arbiter.mjs";
import { normalizeReview } from "./pipeline.mjs";
import { readBrainState } from "./brain.mjs";

const HISTORY = 50;

function writeState(data, state) {
  const p = join(data, "factory", "brain", "state.json");
  mkdirSync(dirname(p), { recursive: true });
  state.history = state.history.slice(-HISTORY);
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

function promptsDir(data) {
  return join(data, "factory", "brain", "prompts");
}

/** 1. Évaluation de la version en cours. */
export function evaluate({ data, config, state, now }) {
  const cur = state.current;
  if (!cur || cur.status !== "evaluating") return null;
  const after = decisions(data).filter((d) => d.at > cur.adoptedAt);
  if (after.length < config.brain.evalWindow) return { id: cur.id, decision: "waiting", seen: after.length };
  const rate = goRate(after.slice(0, config.brain.evalWindow));
  const floor = (cur.baseline ?? 0) - config.brain.tolerance;
  if (cur.baseline !== null && rate < floor) {
    const dir = promptsDir(data);
    rmSync(dir, { recursive: true, force: true });
    const before = join(data, "factory", "brain", "versions", cur.id, "before");
    if (existsSync(before) && readdirSync(before).length) cpSync(before, dir, { recursive: true });
    state.history.push({ id: cur.id, at: now.toISOString(), decision: "reverted", motif: cur.motif, reason: `taux de go ${rate.toFixed(2)} < ${floor.toFixed(2)} (référence ${cur.baseline.toFixed(2)})` });
    state.current = null;
    return { id: cur.id, decision: "reverted", rate };
  }
  state.history.push({ id: cur.id, at: now.toISOString(), decision: "kept", motif: cur.motif, reason: `taux de go ${rate.toFixed(2)} (référence ${cur.baseline?.toFixed(2) ?? "inconnue"})` });
  state.current = { ...cur, status: "kept", keptAt: now.toISOString() };
  return { id: cur.id, decision: "kept", rate };
}

/** 2. Adoption d'une proposition essayée. */
export function adopt({ root, data, config, state, brainDir, verdictDir, now }) {
  state.lastProposalAt = now.toISOString();
  const reject = (reason) => {
    state.history.push({ id: null, at: now.toISOString(), decision: "rejected", motif: proposal?.motif ?? "", reason: String(reason).slice(0, 400) });
    return { decision: "rejected", reason };
  };
  let proposal = null;
  try {
    proposal = JSON.parse(readFileSync(join(brainDir, "proposal.json"), "utf8"));
  } catch {
    return reject("proposition illisible");
  }
  if (state.current?.status === "evaluating") return reject("une version est déjà en évaluation");

  const candDir = join(brainDir, "candidate");
  const candidate = {};
  for (const f of existsSync(candDir) ? readdirSync(candDir) : []) {
    const n = f.replace(/\.md$/, "");
    if (!ZONE_NAMES.includes(n) || !f.endsWith(".md")) return reject(`fichier hors zone : ${f}`);
    const text = readFileSync(join(candDir, f), "utf8");
    const p = checkPrompt(n, text, defaultPrompt(root, n));
    if (p.length) return reject(`${n} : ${p.join(", ")}`);
    candidate[n] = text;
  }
  if (!Object.keys(candidate).length) return reject("aucun prompt candidat");

  // Même règle que l'arbitre, sur l'app d'essai.
  let gate = null;
  let review = null;
  try {
    gate = JSON.parse(readFileSync(join(verdictDir, "gate.json"), "utf8"));
    review = normalizeReview(JSON.parse(readFileSync(join(verdictDir, "review.json"), "utf8")));
  } catch {}
  if (gate && gate.slug !== config.brain.benchSlug) return reject(`verdict pour ${gate.slug}, attendu ${config.brain.benchSlug}`);
  const verdict = decide({ gate, review, config });
  if (!verdict.go) return reject(`app d'essai refusée : ${verdict.reasons.join(" ; ").slice(0, 300)}`);

  const hash = createHash("sha256").update(JSON.stringify(candidate)).digest("hex").slice(0, 10);
  const id = `${now.toISOString().slice(0, 10)}-${hash}`;
  const dir = promptsDir(data);
  const before = join(data, "factory", "brain", "versions", id, "before");
  mkdirSync(before, { recursive: true });
  if (existsSync(dir)) cpSync(dir, before, { recursive: true });
  mkdirSync(dir, { recursive: true });
  for (const [n, text] of Object.entries(candidate)) writeFileSync(join(dir, `${n}.md`), text);
  const recent = decisions(data).slice(-config.brain.baselineWindow);
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").slice(0, 300);
  state.current = {
    id,
    status: "evaluating",
    adoptedAt: now.toISOString(),
    baseline: goRate(recent),
    motif: clean(proposal.motif),
    change: clean(proposal.change),
    files: Object.keys(candidate),
  };
  state.history.push({ id, at: now.toISOString(), decision: "adopted", motif: clean(proposal.motif), reason: clean(proposal.change) });
  return { decision: "adopted", id };
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function brainRecords({ root, data, proposed, brainDir, verdictDir, now = new Date() }) {
  const config = loadConfig(root);
  // L'état du cerveau vit sur data ; readBrainState lit sous <dir>/factory/brain.
  const state = readBrainState(data);
  const evaluation = evaluate({ data, config, state, now });
  const adoption = proposed ? adopt({ root, data, config, state, brainDir, verdictDir, now }) : null;
  if (evaluation || adoption) writeState(data, state);
  return { evaluation, adoption };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const argv = process.argv.slice(2);
  const out = brainRecords({
    root,
    data: resolve(argv[0]),
    proposed: arg(argv, "proposed") === "yes",
    brainDir: resolve(arg(argv, "brain") ?? "/nonexistent"),
    verdictDir: resolve(arg(argv, "verdict") ?? "/nonexistent"),
  });
  console.log(JSON.stringify(out));
}
