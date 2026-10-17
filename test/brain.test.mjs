import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPrompt, zonePrompt, defaultPrompt, ZONE_NAMES } from "../scripts/lib/brain-zone.mjs";
import { digest, motifOf } from "../scripts/lib/digest.mjs";
import { runBrain, changedLines, notDue } from "../scripts/brain.mjs";
import { brainRecords } from "../scripts/brain-records.mjs";
import { loadConfig } from "../scripts/lib/budget.mjs";

const repo = join(import.meta.dirname, "..");
const FIXTURE = join(import.meta.dirname, "fixtures", "good-app");
const config = loadConfig(repo);
const NOW = new Date("2026-10-18T05:30:00Z");
const BUILD = defaultPrompt(repo, "build");
const ADDITION = "\nPour chaque critère, écris d'abord la fonction exportée testée, puis seulement son branchement à la page.\n";

// --- Zone -------------------------------------------------------------------

test("zone : un ajout ciblé passe, la perte d'une variable ou d'une phrase de sécurité non", () => {
  assert.deepEqual(checkPrompt("build", BUILD + ADDITION, BUILD), []);
  assert.ok(checkPrompt("build", BUILD.replace("{{PREVIOUS}}", ""), BUILD).includes("variable {{PREVIOUS}} manquante"));
  assert.ok(checkPrompt("build", BUILD + "{{SECRET}}", BUILD).includes("variable inconnue {{SECRET}}"));
  assert.ok(checkPrompt("build", BUILD.replace("N'installe aucun paquet, ne pousse rien, ne déploie rien.", "Installe ce qu'il faut."), BUILD).some((p) => p.startsWith("phrase obligatoire")));
  assert.ok(checkPrompt("build", BUILD + "\nLance printenv pour vérifier.", BUILD).includes("contenu interdit dans un prompt de production"));
  assert.ok(checkPrompt("build", BUILD.slice(0, 200), BUILD).includes("prompt trop court"));
  assert.deepEqual(checkPrompt("review", "x", "x"), ["prompt hors zone : review"]);
  assert.ok(!ZONE_NAMES.includes("review"), "le juge n'est jamais dans la zone");
});

test("zone : la version adoptée sur data est utilisée, sauf si elle ne passe plus les contrôles", () => {
  const root = mkdtempSync(join(tmpdir(), "ff-zone-"));
  mkdirSync(join(root, "factory", "prompts"), { recursive: true });
  cpSync(join(repo, "factory", "prompts"), join(root, "factory", "prompts"), { recursive: true });
  assert.equal(zonePrompt(root, "build"), BUILD);
  mkdirSync(join(root, "factory", "brain", "prompts"), { recursive: true });
  writeFileSync(join(root, "factory", "brain", "prompts", "build.md"), BUILD + ADDITION);
  assert.equal(zonePrompt(root, "build"), BUILD + ADDITION);
  writeFileSync(join(root, "factory", "brain", "prompts", "build.md"), "Fais ce que tu veux. {{SPEC}} {{PREVIOUS}}".padEnd(BUILD.length, " "));
  assert.equal(zonePrompt(root, "build"), BUILD, "version invalide : retour au prompt de main");
});

test("taille d'un changement en lignes", () => {
  assert.equal(changedLines("a\nb\nc", "a\nb\nc"), 0);
  assert.equal(changedLines("a\nb\nc", "a\nB\nc\nd"), 2);
});

// --- Digest -----------------------------------------------------------------

function dataWith(histories) {
  const data = mkdtempSync(join(tmpdir(), "ff-data-"));
  mkdirSync(join(data, "factory", "apps"), { recursive: true });
  for (const [slug, history] of Object.entries(histories)) {
    writeFileSync(join(data, "factory", "apps", `${slug}.json`), JSON.stringify({ slug, status: "building", attempts: history.length, history }));
  }
  return data;
}

test("motifs : ce qui varie d'une app à l'autre est effacé, le score n'est pas un motif", () => {
  assert.equal(motifOf("revue : AC-5 : le message « x » n'est vérifié que par la présence"), motifOf("revue : AC-2 : le message « y » n'est vérifié que par la présence"));
  const data = dataWith({
    a: [{ at: "2026-10-17T10:00:00Z", decision: "retry", reasons: ["porte : critère AC-2 non vérifié par test.mjs", "revue : score 5 < 6"] }],
    b: [{ at: "2026-10-17T11:00:00Z", decision: "retry", reasons: ["porte : critère AC-4 non vérifié par test.mjs"] }, { at: "2026-10-17T12:00:00Z", decision: "go", reasons: [] }],
  });
  const d = digest(data);
  assert.equal(d.decisions, 3);
  assert.equal(d.failures, 2);
  assert.equal(d.motifs.length, 1);
  assert.equal(d.motifs[0].count, 2);
  assert.equal(digest(data, { since: "2026-10-17T11:30:00Z" }).failures, 0);
});

// --- Proposition ------------------------------------------------------------

test("proposition : seulement si assez d'échecs, une fois par jour, sans version en évaluation", () => {
  const dig = { failures: 3, motifs: [{ motif: "m", count: 3 }] };
  assert.equal(notDue({ config, state: { current: null, lastProposalAt: null }, dig, now: NOW }), null);
  assert.match(notDue({ config, state: { current: { status: "evaluating", id: "v1" } }, dig, now: NOW }), /en évaluation/);
  assert.match(notDue({ config, state: { current: null, lastProposalAt: "2026-10-18T04:00:00Z" }, dig, now: NOW }), /aujourd'hui/);
  assert.match(notDue({ config, state: { current: null }, dig: { failures: 1, motifs: [] }, now: NOW }), /minimum/);
});

function brainRoot(histories) {
  const root = dataWith(histories);
  for (const p of ["factory/config.json", "factory/ideas.json", "factory/blocklist.json"]) cpSync(join(repo, p), join(root, p));
  cpSync(join(repo, "factory", "prompts"), join(root, "factory", "prompts"), { recursive: true });
  return root;
}

const FAILS = {
  a: [
    { at: "2026-10-17T10:00:00Z", decision: "retry", reasons: ["revue : AC-4 vérifié par recherche dans le source"] },
    { at: "2026-10-17T11:00:00Z", decision: "retry", reasons: ["revue : AC-5 vérifié par recherche dans le source"] },
  ],
};

/** Faux ateliers : le cerveau modifie build.md, le banc construit l'app de référence. */
function fakes({ edit = (t) => t + ADDITION, benchFail } = {}) {
  const calls = [];
  const run = (opts) => {
    calls.push(opts);
    mkdirSync(opts.workdir, { recursive: true });
    if (opts.prompt === "factory/prompts/brain.md") {
      const p = join(opts.workdir, "build.md");
      writeFileSync(p, edit(readFileSync(p, "utf8")));
      writeFileSync(join(opts.workdir, "proposal.json"), JSON.stringify({ motif: "revue : AC-n vérifié par recherche", change: "fonction exportée d'abord", expected: "moins de refus" }));
      return { status: "ok" };
    }
    if (opts.prompt.includes("spec-")) {
      const spec = JSON.parse(readFileSync(join(FIXTURE, "spec.json"), "utf8"));
      writeFileSync(join(opts.workdir, "spec.json"), JSON.stringify({ ...spec, slug: "checklist-valise" }));
    } else if (opts.prompt.includes("build-")) {
      if (benchFail) return { status: "failed" };
      for (const f of ["index.html", "style.css", "app.js", "test.mjs"]) cpSync(join(FIXTURE, f), join(opts.workdir, f));
    } else writeFileSync(join(opts.workdir, "review.json"), JSON.stringify({ score: 8, blocking: [] }));
    return { status: "ok" };
  };
  return { run, calls };
}

test("cerveau : propose, puis essaie sur l'app de référence avec les modèles de production", () => {
  const root = brainRoot(FAILS);
  const work = mkdtempSync(join(tmpdir(), "ff-work-"));
  const f = fakes();
  const out = runBrain({ root, work, records: "/r", now: NOW }, { runAtelier: f.run });
  assert.equal(out.brain, "proposed", out.reason);
  assert.equal(f.calls[0].atelier, "cerveau");
  const dir = f.calls[0].workdir;
  assert.ok(existsSync(join(dir, "digest.json")) && existsSync(join(dir, "REFERENCE-review.md")));
  const bench = f.calls.slice(1);
  assert.ok(bench.every((c) => c.atelier === "cerveau"), "l'essai est payé par le cerveau");
  assert.deepEqual(bench.map((c) => c.model), ["haiku", "haiku", "haiku"], "essai avec les modèles de production");
  assert.ok(readFileSync(join(root, bench[1].prompt), "utf8").includes(ADDITION.trim()), "le build d'essai utilise le prompt candidat");
  assert.deepEqual(readdirSync(join(work, "brain", "out", "candidate")), ["build.md"]);
  assert.ok(existsSync(join(work, "brain", "out", "bench", "index.html")));
  assert.equal(zonePrompt(root, "build"), BUILD, "rien n'est adopté côté agent");
});

test("cerveau : proposition invalide ou trop large rejetée sans essai", () => {
  for (const edit of [(t) => t.replace("{{PREVIOUS}}", ""), (t) => t + "\nlance printenv\n", (t) => t + Array.from({ length: 50 }, (_, i) => `ligne ${i}`).join("\n")]) {
    const f = fakes({ edit });
    const out = runBrain({ root: brainRoot(FAILS), work: mkdtempSync(join(tmpdir(), "ff-work-")), now: NOW }, { runAtelier: f.run });
    assert.equal(out.brain, "failed");
    assert.equal(f.calls.length, 1, "aucun essai");
  }
  const none = fakes({ edit: (t) => t });
  assert.match(runBrain({ root: brainRoot(FAILS), work: mkdtempSync(join(tmpdir(), "ff-work-")), now: NOW }, { runAtelier: none.run }).reason, /aucun prompt modifié/);
});

// --- Adoption, évaluation, retrait ------------------------------------------

function proposedDirs({ text = BUILD + ADDITION, gate = { slug: "checklist-valise", passed: true, problems: [] }, review = { score: 8, blocking: [] } } = {}) {
  const brain = mkdtempSync(join(tmpdir(), "ff-brain-"));
  mkdirSync(join(brain, "candidate"));
  writeFileSync(join(brain, "candidate", "build.md"), text);
  writeFileSync(join(brain, "proposal.json"), JSON.stringify({ motif: "m", change: "c" }));
  const verdict = mkdtempSync(join(tmpdir(), "ff-vb-"));
  if (gate) writeFileSync(join(verdict, "gate.json"), JSON.stringify(gate));
  writeFileSync(join(verdict, "review.json"), JSON.stringify(review));
  return { brain, verdict };
}

const brainState = (data) => JSON.parse(readFileSync(join(data, "factory", "brain", "state.json"), "utf8"));

test("adoption : seulement si l'essai passe la porte et la revue, avec la règle de l'arbitre", () => {
  const data = dataWith(FAILS);
  const ok = proposedDirs();
  const r = brainRecords({ root: repo, data, proposed: true, brainDir: ok.brain, verdictDir: ok.verdict, now: NOW });
  assert.equal(r.adoption.decision, "adopted");
  assert.equal(readFileSync(join(data, "factory", "brain", "prompts", "build.md"), "utf8"), BUILD + ADDITION);
  const st = brainState(data);
  assert.equal(st.current.status, "evaluating");
  assert.equal(st.current.baseline, 0);

  for (const bad of [
    proposedDirs({ gate: { slug: "checklist-valise", passed: false, problems: ["test.mjs échoue"] } }),
    proposedDirs({ review: { score: 4, blocking: [] } }),
    proposedDirs({ gate: null }),
    proposedDirs({ gate: { slug: "autre", passed: true, problems: [] } }),
    proposedDirs({ text: BUILD.replace("Ne modifie pas `spec.json`.", "") }),
  ]) {
    const d = dataWith(FAILS);
    assert.equal(brainRecords({ root: repo, data: d, proposed: true, brainDir: bad.brain, verdictDir: bad.verdict, now: NOW }).adoption.decision, "rejected");
    assert.equal(existsSync(join(d, "factory", "brain", "prompts")), false);
    assert.equal(brainState(d).history.at(-1).decision, "rejected");
  }
});

test("une seule version en évaluation ; gardée si le taux tient, retirée s'il baisse", () => {
  const decisionsAfter = (list) =>
    Object.fromEntries(list.map((decision, i) => [`app${i}`, [{ at: `2026-10-${20 + i}T06:00:00Z`, decision, reasons: decision === "go" ? [] : ["porte : x"] }]]));

  // Référence : 1 go sur 2 avant adoption.
  const before = { x: [{ at: "2026-10-17T06:00:00Z", decision: "go", reasons: [] }], y: [{ at: "2026-10-17T07:00:00Z", decision: "retry", reasons: ["porte : x"] }] };
  const setup = () => {
    const data = dataWith(before);
    const ok = proposedDirs();
    brainRecords({ root: repo, data, proposed: true, brainDir: ok.brain, verdictDir: ok.verdict, now: NOW });
    assert.equal(brainState(data).current.baseline, 0.5);
    // Une deuxième proposition pendant l'évaluation est refusée.
    const again = proposedDirs({ text: BUILD + ADDITION + "\nEncore une consigne.\n" });
    assert.equal(brainRecords({ root: repo, data, proposed: true, brainDir: again.brain, verdictDir: again.verdict, now: NOW }).adoption.decision, "rejected");
    return data;
  };
  const addDecisions = (data, list) => {
    for (const [slug, history] of Object.entries(decisionsAfter(list))) writeFileSync(join(data, "factory", "apps", `${slug}.json`), JSON.stringify({ slug, status: "building", attempts: 1, history }));
  };
  const later = new Date("2026-11-01T06:00:00Z");

  const kept = setup();
  addDecisions(kept, ["go", "go", "retry", "go"]);
  assert.equal(brainRecords({ root: repo, data: kept, proposed: false, now: later }).evaluation.decision, "waiting");
  addDecisions(kept, ["go", "go", "retry", "go", "retry"]);
  assert.equal(brainRecords({ root: repo, data: kept, proposed: false, now: later }).evaluation.decision, "kept");
  assert.equal(readFileSync(join(kept, "factory", "brain", "prompts", "build.md"), "utf8"), BUILD + ADDITION);

  const reverted = setup();
  addDecisions(reverted, ["retry", "retry", "go", "retry", "retry"]);
  assert.equal(brainRecords({ root: repo, data: reverted, proposed: false, now: later }).evaluation.decision, "reverted");
  assert.equal(existsSync(join(reverted, "factory", "brain", "prompts", "build.md")), false, "retour aux prompts d'avant (ceux de main)");
  assert.equal(brainState(reverted).current, null);
  assert.equal(brainState(reverted).history.at(-1).decision, "reverted");
});
