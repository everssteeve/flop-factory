// Ligne de commande d'un run autonome Claude Code. Isolée pour être testée :
// c'est elle qui garantit que chaque run est borné (budget, tours, outils,
// sandbox) et qu'aucune option ne l'élargit.

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
    "json",
    "--model",
    model,
    "--max-budget-usd",
    capUsd.toFixed(2),
    "--max-turns",
    String(maxTurns),
    "--tools",
    RUN_TOOLS,
    "--permission-mode",
    "dontAsk",
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
