// Ligne de commande d'un run autonome Claude Code. Isolée pour être testée :
// c'est elle qui garantit que chaque run est borné (budget, tours, outils,
// sandbox) et qu'aucune option ne l'élargit. Pas de --permission-mode : avec
// CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, Claude Code impose le mode par défaut ;
// les outils autorisés sont déclarés, tout le reste est refusé faute d'humain.
// Sortie stream-json : l'événement d'initialisation dit quels plugins sont chargés.

/** Nom du plugin dérivé, dont le chargement est vérifié à chaque run. */
export const PLUGIN_NAME = "flop-factory-harness";

export const RUN_TOOLS = "Bash,Read,Edit,Write,Glob,Grep";
/** Atelier Découverte : recherche web, sans shell ni récupération de pages. */
export const DISCOVERY_TOOLS = "WebSearch,Read,Write";
const ALLOWED_TOOLSETS = new Set([RUN_TOOLS, DISCOVERY_TOOLS]);

export function claudeArgs({ prompt, model, capUsd, maxTurns, pluginDir, rulesFile, settingsFile, tools = RUN_TOOLS }) {
  if (!ALLOWED_TOOLSETS.has(tools)) throw new Error(`jeu d'outils non prévu : ${tools}`);
  if (!(capUsd > 0)) throw new Error("un run doit avoir un plafond de dépense positif");
  if (!(maxTurns > 0)) throw new Error("un run doit avoir un nombre de tours maximum");
  if (!settingsFile) throw new Error("un run doit avoir ses réglages de sandbox");
  // --bare ne propose que Bash, Edit et Read (vérifié sur 2.1.302) : la recherche
  // web et Write n'existent qu'hors --bare. Seul l'atelier Découverte, qui n'a pas
  // de shell, tourne ainsi ; son HOME est celui, vierge, du runner.
  const bare = tools === DISCOVERY_TOOLS ? [] : ["--bare"];
  return [
    "-p",
    prompt,
    ...bare,
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
    tools,
    "--permission-prompts",
    "none",
    "--allowedTools",
    tools,
    "--settings",
    settingsFile,
    "--plugin-dir",
    pluginDir,
    "--append-system-prompt-file",
    rulesFile,
    "--no-session-persistence",
    // Aucun serveur MCP : celui du harness amont (context7, distant) donnerait aux
    // agents un canal réseau que la sandbox ne voit pas.
    "--strict-mcp-config",
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

/**
 * Plugins intégrés au binaire Claude Code (préfixe cc-plugin-) : ils se
 * chargent même en --bare et ne viennent pas de nous. Tout autre plugin que le
 * nôtre est une anomalie.
 */
export function unexpectedPlugins(init) {
  return (init?.plugins ?? [])
    .map((p) => p?.name)
    .filter((n) => n !== PLUGIN_NAME && !String(n).startsWith("cc-plugin-"));
}

/** Le plugin des garde-fous est-il chargé, sans erreur, et seul de son espèce ? */
export function pluginLoaded(init) {
  if (!init) return false;
  const loaded = (init.plugins ?? []).some((p) => p?.name === PLUGIN_NAME);
  const errors = (init.plugin_errors ?? []).length;
  return loaded && errors === 0 && unexpectedPlugins(init).length === 0;
}
