#!/usr/bin/env node
// Vérifie, avant tout atelier, que les garde-fous qui vont réellement tourner
// sont en place. Ne dépend pas de la bonne volonté du modèle : un modèle qui
// refuse de lui-même une commande dangereuse ne prouve rien sur les hooks.
//
//   1. Le hook livré dans dist/plugin est appelé directement avec des cas
//      connus : il doit refuser et laisser passer exactement ce qui est prévu.
//   2. Une vraie session Claude Code, très courte, doit démarrer (la sandbox
//      stricte fait échouer le démarrage si elle est indisponible) et annoncer
//      le plugin des garde-fous chargé, sans erreur.
//
// Échec = sortie 1, et le workflow n'enchaîne aucun atelier ce jour-là.
//
//   node scripts/guard-smoke.mjs <workdir> [records]

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runAtelier } from "./run-atelier.mjs";

/** Cas que le hook livré doit trancher exactement ainsi. */
export const HOOK_CASES = [
  { tool: "Bash", input: { command: "printenv" }, expect: "deny" },
  { tool: "Bash", input: { command: "cat /proc/self/environ" }, expect: "deny" },
  { tool: "Bash", input: { command: "git push origin main" }, expect: "deny" },
  { tool: "Bash", input: { command: "vercel --prod" }, expect: "deny" },
  { tool: "Bash", input: { command: "curl https://api.anthropic.com/v1/messages" }, expect: "deny" },
  { tool: "Write", input: { file_path: "../../.git/hooks/pre-commit", content: "x" }, expect: "deny" },
  { tool: "Bash", input: { command: "node test.mjs" }, expect: "allow" },
  { tool: "Write", input: { file_path: "index.html", content: "x" }, expect: "allow" },
];

/** Rejoue HOOK_CASES contre un fichier de hook ; renvoie la liste des écarts. */
export function checkHook(hookFile) {
  const cwd = mkdtempSync(join(tmpdir(), "ff-smoke-"));
  const problems = [];
  for (const c of HOOK_CASES) {
    const r = spawnSync("node", [hookFile], {
      input: JSON.stringify({ tool_name: c.tool, tool_input: c.input, cwd }),
      encoding: "utf8",
      timeout: 10_000,
    });
    let decision = "allow";
    if (r.status !== 0) decision = "crash";
    else if (r.stdout.trim()) {
      try {
        decision = JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision ?? "unknown";
      } catch {
        decision = "unreadable";
      }
    }
    if (decision !== c.expect) problems.push(`${c.tool} ${JSON.stringify(c.input)} : attendu ${c.expect}, obtenu ${decision}`);
  }
  return problems;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [workdir = join(root, "work", "guard-smoke"), records] = process.argv.slice(2);
  const fail = (msg) => {
    console.error(msg);
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, "guard=broken\n", { flag: "a" });
    process.exit(1);
  };

  const problems = checkHook(join(root, "dist", "plugin", "hooks", "ci-guard.mjs"));
  if (problems.length) fail("Hook livré non conforme :\n- " + problems.join("\n- "));
  console.log(`hook livré : ${HOOK_CASES.length} cas conformes`);

  rmSync(workdir, { recursive: true, force: true });
  const outcome = runAtelier(
    { atelier: "qualite", prompt: "factory/prompts/guard-smoke.md", workdir, records, maxTurns: "3", model: "haiku" },
    { root },
  );
  console.log(JSON.stringify({ status: outcome.status, runId: outcome.runId, usd: outcome.usd, guarded: outcome.guarded }));
  if (outcome.status === "stopped" || outcome.status === "no-budget") {
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, "guard=skipped\n", { flag: "a" });
    process.exit(0);
  }
  if (!outcome.guarded) fail("La session n'a pas chargé le plugin des garde-fous (ou avec des erreurs).");
  if (outcome.status !== "ok") fail("La session de contrôle n'a pas abouti (sandbox indisponible ?). Voir le journal du run.");
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, "guard=ok\n", { flag: "a" });
}
