// Ligne de commande d'un run autonome Claude Code. Isolée pour être testée :
// c'est elle qui garantit que chaque run est borné (budget, tours, outils,
// sandbox) et qu'aucune option ne l'élargit. Pas de --permission-mode : avec
// CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, Claude Code impose le mode par défaut ;
// les outils autorisés sont déclarés, tout le reste est refusé faute d'humain.
// Sortie stream-json : l'événement d'initialisation dit quels plugins sont chargés.

/** Nom du plugin dérivé, dont le chargement est vérifié à chaque run. */
export const PLUGIN_NAME = "flop-factory-harness";

export const RUN_TOOLS = "Bash,Read,Edit,Write,Glob,Grep";

export function claudeArgs({ prompt, model, capUsd, maxTurns, pluginDir, rulesFile, settingsFile }) {
  if (!(capUsd > 0)) throw new Error("un run doit avoir un plafond de dépense positif");
  if (!(maxTurns > 0)) throw new Error("un run doit avoir un nombre de tours maximum");
  if (!settingsFile) throw new Error("un run doit avoir ses réglages de sandbox");
  return [
    "-p",
    prompt,
    "--bare",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--max-budget-usd",
    capUsd.toFixed(2),
    "--max-turns",
    String(maxTurns),
    "--tools",
    RUN_TOOLS,
    "--permission-prompts",
    "none",
    "--allowedTools",
    RUN_TOOLS,
    "--settings",
    settingsFile,
    "--plugin-dir",
    pluginDir,
    "--append-system-prompt-file",
    rulesFile,
    "--no-session-persistence",
  ];
}

/** Environnement du processus claude : la clé API, rien d'autre de secret. */
export function claudeEnv(env) {
  return {
    PATH: env.PATH,
    HOME: env.HOME,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    // Retire les identifiants de l'environnement de tous les sous-processus.
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
    CI: "1",
  };
}

/**
 * Lit la sortie stream-json d'un run : l'événement d'initialisation et le
 * résultat final. Accepte aussi une sortie json d'un seul bloc.
 */
export function parseOutput(stdout) {
  let init = null;
  let result = null;
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj?.type === "system" && obj.subtype === "init" && !init) init = obj;
    else if (obj?.type === "result") result = obj;
    else if (!obj?.type && "total_cost_usd" in (obj ?? {})) result = obj;
  }
  return { init, result };
}

/** Le plugin des garde-fous est-il chargé, sans erreur ? */
export function pluginLoaded(init) {
  if (!init) return false;
  const loaded = (init.plugins ?? []).some((p) => p?.name === PLUGIN_NAME);
  const errors = (init.plugin_errors ?? []).length;
  return loaded && errors === 0;
}
