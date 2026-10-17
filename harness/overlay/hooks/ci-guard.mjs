#!/usr/bin/env node
// ci-guard.mjs - PreToolUse hook de Flop Factory pour les runs sans humain.
//
// Différences avec le guard-bash.mjs d'origine :
//   1. Une décision "ask" devient "deny" : personne n'est là pour répondre.
//      Ce qui demandait une confirmation (push, déploiement prod, db:push...)
//      est fait par les étapes du workflow, après les portes qualité, jamais
//      par le modèle.
//   2. FAIL-CLOSED : si les règles ne se chargent pas ou si l'entrée est
//      illisible, la commande est refusée. Une session sans humain qui casse
//      vaut mieux qu'une session sans garde-fou.
//   3. Des règles propres à l'usine s'ajoutent (clés live, suppressions,
//      achats, lecture des secrets du runner).
//
// Contrat Claude Code : stdin = {"tool_name", "tool_input":{"command"}},
// stdout = {"hookSpecificOutput":{"hookEventName":"PreToolUse",
// "permissionDecision":"deny","permissionDecisionReason":"..."}}.

import { resolve, dirname, sep } from "node:path";
import { realpathSync, existsSync } from "node:fs";

const SHELL_TOOLS = new Set(["Bash", "Monitor"]);
/** Outils d'écriture : ils tournent hors de la sandbox, donc bornés ici. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Chemin réel d'un fichier qui n'existe peut-être pas encore. */
function realish(p) {
  let cur = p;
  const rest = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(cur.slice(parent.length + 1));
    cur = parent;
  }
  const base = existsSync(cur) ? realpathSync(cur) : cur;
  return rest.length ? resolve(base, ...rest) : base;
}

/** Refuse toute écriture hors du dossier de travail du run (liens symboliques compris). */
export function writeVerdict(toolInput, cwd) {
  const target = toolInput?.file_path ?? toolInput?.notebook_path;
  if (typeof target !== "string" || typeof cwd !== "string" || !cwd) {
    return { decision: "deny", reason: "Écriture sans chemin ou sans dossier de travail : refusée.", rule: "write-unknown" };
  }
  const root = realish(resolve(cwd));
  const real = realish(resolve(cwd, target));
  if (real !== root && !real.startsWith(root + sep)) {
    return { decision: "deny", reason: `Écriture hors du dossier de travail refusée (${target}).`, rule: "write-outside" };
  }
  return null;
}

/** Règles de l'usine, testées sur la ligne de commande entière. */
export const FACTORY_RULES = [
  {
    id: "live-keys",
    test: /\b(sk|rk|pk)_live_[A-Za-z0-9]/,
    reason: "Clé Stripe live détectée : l'usine n'encaisse jamais d'argent réel. Utilise les clés de test (sk_test_).",
  },
  {
    id: "repo-delete",
    test: /\bgh\s+(?:[^|;&]*\s)?repo\s+(?:delete|archive)\b/,
    reason: "Supprimer ou archiver un repo est réservé au workflow Run (verdict J+30).",
  },
  {
    id: "vercel-remove",
    test: /\bvercel(?:@\S+)?\s+(?:[^|;&]*\s)?(?:remove|rm|project\s+(?:rm|remove))\b/,
    reason: "Supprimer un projet ou un déploiement Vercel est interdit à l'usine.",
  },
  {
    id: "domain-buy",
    test: /\bvercel(?:@\S+)?\s+(?:[^|;&]*\s)?domains?\s+buy\b/,
    reason: "Acheter un nom de domaine est hors budget : décision humaine.",
  },
  {
    id: "neon-delete",
    test: /\bneonctl\s+(?:[^|;&]*\s)?(?:projects?|branches?|databases?)\s+(?:delete|rm)\b/,
    reason: "Supprimer une base Neon est interdit à l'usine.",
  },
  {
    id: "secret-read",
    test: /(?:\$\{?|\benv\s*\[\s*["']?|process\.env\.)(?:ANTHROPIC_API_KEY|VERCEL_TOKEN|FACTORY_GH_TOKEN|GITHUB_TOKEN|GH_TOKEN|NEON_API_KEY)\b|^\s*(?:printenv|env|export\s+-p)\s*(?:$|[|;&>])/m,
    reason: "Lire les secrets du runner est interdit : ils ne quittent jamais le workflow.",
  },
  {
    id: "environ-dump",
    test: /\/proc\/[^\s'"]*environ|\bos\.environ\b|\bos\.getenv\b|\bENV\.to_h\b/,
    reason: "Lire l'environnement d'un processus est interdit en run autonome.",
  },
  {
    id: "nested-agent",
    test: /(?:^|[\s;&|(/])claude(?:\s|$)|api\.anthropic\.com/m,
    reason: "Lancer un autre agent ou appeler l'API directement contournerait le budget du run.",
  },
];

export function factoryVerdict(command) {
  for (const rule of FACTORY_RULES) {
    if (rule.test.test(command)) return { decision: "deny", reason: rule.reason, rule: rule.id };
  }
  return null;
}

/** Décision finale pour une commande, `decide` = règles amont d'Hypervibe. */
export function ciDecide(command, decide) {
  const own = factoryVerdict(command);
  if (own) return own;
  const upstream = decide(command);
  if (!upstream) return null;
  if (upstream.decision === "ask") {
    return {
      decision: "deny",
      reason: `Confirmation humaine requise en local, donc refusé en run autonome. ${upstream.reason}`,
      rule: "ask-to-deny",
    };
  }
  return upstream;
}

function out(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: `[Flop Factory] ${reason}`,
      },
    }),
  );
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), 5000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    const payload = JSON.parse(await readStdin());
    if (WRITE_TOOLS.has(payload?.tool_name)) {
      const verdict = writeVerdict(payload?.tool_input, payload?.cwd);
      if (verdict) out(verdict.decision, verdict.reason);
      process.exit(0);
    }
    if (!SHELL_TOOLS.has(payload?.tool_name)) process.exit(0);
    const command = payload?.tool_input?.command;
    if (typeof command !== "string") {
      out("deny", "Commande illisible, refusée par prudence.");
      process.exit(0);
    }
    const { decide } = await import("./rules.mjs");
    const verdict = ciDecide(command, decide);
    if (verdict) out(verdict.decision, verdict.reason);
    process.exit(0);
  } catch (e) {
    out("deny", `Garde-fou indisponible (${e instanceof Error ? e.message : String(e)}) : commande refusée.`);
    process.exit(0);
  }
}
