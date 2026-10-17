#!/usr/bin/env node
// Construit le plugin utilisé par les runs autonomes : copie du harness amont
// (harness/upstream, jamais modifié à la main) + surcouche Flop Factory
// (harness/overlay). Résultat dans dist/plugin, recréé à chaque appel.
//
// Le hook amont guard-bash.mjs est REMPLACÉ, pas complété : ses décisions
// "ask" n'ont personne pour y répondre en CI. ci-guard.mjs réutilise ses
// règles (rules.mjs) et les rend bloquantes.

import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = join(root, "harness", "upstream");
const overlay = join(root, "harness", "overlay");
const dist = join(root, "dist", "plugin");

if (!existsSync(join(upstream, "hooks", "rules.mjs"))) {
  console.error("harness/upstream incomplet : hooks/rules.mjs introuvable");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
cpSync(upstream, dist, { recursive: true });
cpSync(overlay, dist, { recursive: true });

// Un seul hook Bash : celui de l'usine.
writeFileSync(
  join(dist, "hooks", "hooks.json"),
  JSON.stringify(
    {
      description:
        "Flop Factory : garde-fous des runs autonomes. Les confirmations deviennent des refus, fail-closed.",
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|Monitor",
            hooks: [
              {
                type: "command",
                command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/ci-guard.mjs"',
                timeout: 10,
              },
            ],
          },
          {
            matcher: "Write|Edit|MultiEdit|NotebookEdit",
            hooks: [
              {
                type: "command",
                command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/ci-guard.mjs"',
                timeout: 10,
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  ) + "\n",
);

// Le nom « Hypervibe » est une marque : le plugin dérivé porte son propre nom.
const manifestPath = join(dist, ".claude-plugin", "plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.name = "flop-factory-harness";
manifest.description =
  "Harness des runs autonomes de Flop Factory, dérivé du projet open source hypervibe-harness (Apache-2.0) de Flavien Chervet. Sans affiliation.";
manifest.homepage = "https://github.com/everssteeve/flop-factory";
manifest.repository = "https://github.com/everssteeve/flop-factory";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
rmSync(join(dist, ".claude-plugin", "marketplace.json"), { force: true });

console.log(`plugin construit : ${dist}`);
