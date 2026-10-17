#!/usr/bin/env node
// Lance un run d'atelier borné : arrêt d'urgence, budget, modèle, garde-fous,
// sandbox, puis note le coût réel et le journal du run.
//
//   node scripts/run-atelier.mjs --atelier build --prompt factory/prompts/socle-hello.md \
//     --workdir "$RUNNER_TEMP/ff-work/hello" --records "$RUNNER_TEMP/ff-records"
//
// Lecture : config et ledger du dépôt (`root`). Écriture : uniquement dans
// `records`, un dossier hors de portée de l'agent, qu'un job séparé valide puis
// fusionne dans le dépôt. Sans --records, écrit dans le dépôt (usage local).
//
// Sorties (aussi dans $GITHUB_OUTPUT) : status = stopped | no-budget | ok | failed, run_id.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadConfig, dayKey, readLedger, runCap, record, costFromResult } from "./lib/budget.mjs";
import { claudeArgs, claudeEnv, parseOutput, pluginLoaded, RUN_TOOLS, DISCOVERY_TOOLS } from "./lib/claude-args.mjs";

/** Profils de run : outils et réglages. Découverte = recherche web sans shell. */
export const PROFILES = {
  build: { tools: RUN_TOOLS, settings: "run-settings.json" },
  discovery: { tools: DISCOVERY_TOOLS, settings: "run-settings-discovery.json" },
};

/** Durée maximale d'un run, sous le timeout du job pour toujours noter son coût. */
export const RUN_TIMEOUT_MS = 35 * 60 * 1000;

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!key || argv[i + 1] === undefined) throw new Error(`argument incomplet : ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  for (const k of ["atelier", "prompt", "workdir"]) if (!opts[k]) throw new Error(`--${k} manquant`);
  return opts;
}

/** Modèle du run : celui de l'atelier, ou l'escalade après N échecs consécutifs. */
export function pickModel(config, atelier, failures, override) {
  if (override) return override;
  const base = config.models.byAtelier[atelier] ?? config.models.default;
  return failures >= config.models.escalateAfterFailures ? config.models.escalation : base;
}

/** Le ledger du jour tel que les écritures de ce job l'ont déjà fait évoluer. */
function currentLedger(root, out, day) {
  return existsSync(join(out, "factory", "ledger", `${day}.json`)) ? readLedger(out, day) : readLedger(root, day);
}

function readStreaks(root, out) {
  for (const base of [out, root]) {
    const p = join(base, "factory", "runs", "streaks.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return {};
}

function writeJson(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

export function runAtelier(opts, { root, now = new Date(), spawn = spawnSync, env = process.env } = {}) {
  const config = loadConfig(root);
  const out = opts.records ? resolve(opts.records) : root;
  const runId = `${opts.atelier}-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;

  if (existsSync(join(root, "STOP"))) return { status: "stopped", runId };

  const day = dayKey(now, config.budget.timezone);
  if (opts.records) {
    // Le ledger fusionné repart toujours de l'état du dépôt.
    const p = join(out, "factory", "ledger", `${day}.json`);
    if (!existsSync(p)) writeJson(p, readLedger(root, day));
  }
  const { capUsd, remainingUsd, exhausted } = runCap(config, currentLedger(root, out, day), opts.atelier);
  if (exhausted) return { status: "no-budget", runId, remainingUsd };

  const streakKey = `${opts.atelier}:${opts.prompt}`;
  const streaks = readStreaks(root, out);
  const model = pickModel(config, opts.atelier, streaks[streakKey] ?? 0, opts.model);

  const blocklist = JSON.parse(readFileSync(join(root, "factory", "blocklist.json"), "utf8"));
  const rulesFile = join(root, "dist", "run-rules.md");
  mkdirSync(dirname(rulesFile), { recursive: true });
  writeFileSync(
    rulesFile,
    readFileSync(join(root, "harness", "overlay", "RUN-RULES.md"), "utf8") +
      "\n## Sujets interdits\n\n" +
      blocklist.topics.map((t) => `- ${t}`).join("\n") +
      "\n",
  );

  const workdir = isAbsolute(opts.workdir) ? opts.workdir : resolve(root, opts.workdir);
  mkdirSync(workdir, { recursive: true });
  const prompt = readFileSync(join(root, opts.prompt), "utf8");
  const profile = PROFILES[opts.profile ?? "build"];
  if (!profile) throw new Error(`profil inconnu : ${opts.profile}`);
  const args = claudeArgs({
    prompt,
    model,
    capUsd,
    maxTurns: Number(opts.maxTurns ?? config.runs.maxTurns),
    pluginDir: join(root, "dist", "plugin"),
    rulesFile,
    settingsFile: join(root, "harness", "overlay", profile.settings),
    tools: profile.tools,
  });

  const proc = spawn("claude", args, {
    cwd: workdir,
    env: claudeEnv(env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: RUN_TIMEOUT_MS,
    killSignal: "SIGINT",
  });

  const { init, result } = parseOutput(proc.stdout);
  // Sans le plugin des garde-fous, un run n'est jamais considéré comme réussi.
  const guarded = pluginLoaded(init);

  // Coût inconnu (plantage, run tué) = on compte le plafond entier.
  let usd;
  try {
    usd = costFromResult(result);
  } catch {
    usd = capUsd;
  }

  let report = null;
  try {
    report = JSON.parse(readFileSync(join(workdir, "report.json"), "utf8"));
  } catch {
    report = null;
  }

  const ok = guarded && proc.status === 0 && !proc.error && result && !result.is_error && report?.status === "ok";
  const status = ok ? "ok" : "failed";

  // Le ledger écrit repart de l'état lu avant le run : l'agent n'a aucune prise dessus.
  const ledgerBase = opts.records ? out : root;
  record(ledgerBase, day, { runId, atelier: opts.atelier, model, usd, status, at: now.toISOString() });

  streaks[streakKey] = ok ? 0 : (streaks[streakKey] ?? 0) + 1;
  writeJson(join(out, "factory", "runs", "streaks.json"), streaks);

  const log = {
    runId,
    atelier: opts.atelier,
    prompt: opts.prompt,
    model,
    capUsd,
    remainingBeforeUsd: remainingUsd,
    usd,
    status,
    exitCode: proc.status,
    guarded,
    plugins: (init?.plugins ?? []).map((p) => p?.name),
    // Outils réellement offerts au modèle et sa dernière réponse : de quoi comprendre un run qui n'a rien fait.
    tools: (init?.tools ?? []).map((t) => String(t)).slice(0, 50),
    missingTools: init ? profile.tools.split(",").filter((t) => !(init.tools ?? []).includes(t)) : null,
    resultText: typeof result?.result === "string" ? result.result.slice(0, 2000) : null,
    pluginErrors: init?.plugin_errors ?? [],
    timedOut: proc.error?.code === "ETIMEDOUT",
    subtype: result?.subtype ?? null,
    numTurns: result?.num_turns ?? null,
    permissionDenials: result?.permission_denials ?? [],
    // Le rapport vient de l'agent : borné pour ne jamais gonfler la branche data.
    report: JSON.stringify(report ?? null).length <= 8000 ? report : { truncated: true, status: String(report?.status ?? "").slice(0, 20) },
    stderrTail: (proc.stderr ?? "").slice(-4000),
  };
  writeJson(join(out, "factory", "runs", day, `${runId}.json`), log);

  return { status, runId, usd, model, guarded, denials: log.permissionDenials };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const outcome = runAtelier(parseArgs(process.argv.slice(2)), { root });
  console.log(JSON.stringify({ ...outcome, denials: outcome.denials?.length ?? 0 }));
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `status=${outcome.status}\nrun_id=${outcome.runId}\n`, { flag: "a" });
  }
}
