#!/usr/bin/env node
// Cerveau, côté records (seul job qui écrit) :
//   1. Évalue la version de prompts en cours : après evalWindow décisions, si le
//      taux de go est tombé de plus de `tolerance` sous la référence, elle est
//      retirée (les prompts d'avant sont restaurés) ; sinon elle est gardée.
//   2. Adopte une nouvelle proposition seulement si elle repasse les contrôles
//      de code et si l'app d'essai a passé la porte et la revue (même règle que
//      l'arbitre). Une seule version en évaluation à la fois.
//
//   node scripts/brain-records.mjs <data-dir> --proposed yes|failed|no [--reason R] [--brain <dir>] [--verdict <dir>] [--event <fichier>]
//
// --event : en cas d'adoption ou de retrait, un résumé lisible y est écrit ; le
// workflow en fait une issue, pour qu'un humain puisse relire après coup.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, cpSync, lstatSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { loadConfig } from "./lib/budget.mjs";
import { ZONE_NAMES, checkPrompt, defaultPrompt, sha, lineDiff } from "./lib/brain-zone.mjs";
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
    if (!lstatSync(join(candDir, f)).isFile()) return reject(`entrée inattendue : ${f}`);
    if (!ZONE_NAMES.includes(n) || !f.endsWith(".md")) return reject(`fichier hors zone : ${f}`);
    const text = readFileSync(join(candDir, f), "utf8");
    const def = defaultPrompt(root, n);
    const inForce = join(promptsDir(data), `${n}.md`);
    const current = existsSync(inForce) ? readFileSync(inForce, "utf8") : def;
    const p = checkPrompt(n, text, def, { current, maxChangedLines: config.brain.maxChangedLines });
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
  const diffs = {};
  for (const [n, text] of Object.entries(candidate)) {
    const inForce = join(dir, `${n}.md`);
    const before = existsSync(inForce) ? readFileSync(inForce, "utf8") : defaultPrompt(root, n);
    diffs[n] = lineDiff(before, text);
    writeFileSync(inForce, text);
    writeFileSync(join(dir, `${n}.meta.json`), JSON.stringify({ baseSha: sha(defaultPrompt(root, n)), version: id }) + "\n");
  }
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
  return { decision: "adopted", id, motif: state.current.motif, change: state.current.change, diffs };
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function brainRecords({ root, data, proposed, reason, brainDir, verdictDir, now = new Date() }) {
  const config = loadConfig(root);
  // L'état du cerveau vit sur data ; readBrainState lit sous <dir>/factory/brain.
  const state = readBrainState(data);
  const evaluation = evaluate({ data, config, state, now });
  let adoption = null;
  if (proposed === "yes" || proposed === true) adoption = adopt({ root, data, config, state, brainDir, verdictDir, now });
  else if (proposed === "failed") {
    // Proposition rejetée dès le job agent : notée, et pas de nouvel essai avant demain.
    state.lastProposalAt = now.toISOString();
    state.history.push({ id: null, at: now.toISOString(), decision: "rejected", motif: "", reason: String(reason ?? "proposition invalide").slice(0, 400) });
    adoption = { decision: "rejected", reason };
  }
  if (evaluation || adoption) writeState(data, state);
  return { evaluation, adoption };
}

/** Résumé lisible d'une adoption ou d'un retrait, pour une issue. */
export function eventText(out) {
  const a = out.adoption;
  const e = out.evaluation;
  const parts = [];
  if (a?.decision === "adopted") {
    parts.push(`## Version ${a.id} adoptée\n\nMotif traité : ${a.motif}\n\nChangement : ${a.change}\n`);
    for (const [n, d] of Object.entries(a.diffs ?? {})) {
      parts.push(`### ${n}.md (+${d.added.length} / -${d.removed})\n\n${d.added.map((l) => `> ${l}`).join("\n")}\n`);
    }
    parts.push("Elle sera gardée ou retirée automatiquement selon les prochaines décisions de l'arbitre.");
  }
  if (e?.decision === "reverted") parts.push(`## Version ${e.id} retirée\n\nTaux de go ${e.rate.toFixed(2)} sous la référence : les prompts d'avant sont rétablis.`);
  return parts.length ? parts.join("\n") : null;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const argv = process.argv.slice(2);
  // Jamais bloquant : un plantage ici ne doit empêcher ni le commit des données ni la publication.
  try {
    const out = brainRecords({
      root,
      data: resolve(argv[0]),
      proposed: arg(argv, "proposed"),
      reason: arg(argv, "reason"),
      brainDir: resolve(arg(argv, "brain") ?? "/nonexistent"),
      verdictDir: resolve(arg(argv, "verdict") ?? "/nonexistent"),
    });
    console.log(JSON.stringify({ evaluation: out.evaluation, adoption: out.adoption?.decision ?? null }));
    const text = eventText(out);
    if (text && arg(argv, "event")) {
      writeFileSync(resolve(arg(argv, "event")), text + "\n");
      if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, "event=yes\n", { flag: "a" });
    }
  } catch (e) {
    console.log(`::warning::cerveau (records) : ${e.message}`);
  }
}
