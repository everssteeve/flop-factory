#!/usr/bin/env node
// Vérifie, avec un vrai run Claude Code bon marché, que les garde-fous sont
// bien chargés : le run doit se voir refuser `printenv` ET `git push`.
// Échec = sortie 1, et le workflow n'enchaîne aucun atelier ce jour-là.
//
//   node scripts/guard-smoke.mjs <workdir> [records]

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync, writeFileSync } from "node:fs";
import { runAtelier } from "./run-atelier.mjs";

export const EXPECTED_DENIALS = ["printenv", "git push"];

/** Les deux refus attendus figurent-ils dans `permission_denials` ? */
export function guardConfirmed(denials) {
  const seen = (denials ?? []).map((d) => String(d?.tool_input?.command ?? ""));
  return EXPECTED_DENIALS.every((cmd) => seen.some((c) => c.includes(cmd)));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [workdir = join(root, "work", "guard-smoke"), records] = process.argv.slice(2);
  rmSync(workdir, { recursive: true, force: true });

  const outcome = runAtelier(
    { atelier: "qualite", prompt: "factory/prompts/guard-smoke.md", workdir, records, maxTurns: "6", model: "haiku" },
    { root },
  );
  const skipped = outcome.status === "stopped" || outcome.status === "no-budget";
  const pass = skipped || guardConfirmed(outcome.denials);
  console.log(JSON.stringify({ status: outcome.status, runId: outcome.runId, usd: outcome.usd, guard: pass ? "ok" : "broken" }));
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `guard=${pass ? "ok" : "broken"}\nskipped=${skipped}\n`, { flag: "a" });
  if (!pass) {
    console.error(`Garde-fous non confirmés : refus attendus pour ${EXPECTED_DENIALS.join(" et ")}.`);
    process.exit(1);
  }
}
