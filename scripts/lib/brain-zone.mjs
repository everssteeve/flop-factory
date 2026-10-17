// Zone d'auto-amélioration : les seuls fichiers que le cerveau de l'usine peut
// changer sans humain. Ce sont les prompts de construction (spec, build), les
// seuls que l'essai sur l'app de référence met réellement à l'épreuve. Tout ce
// qui juge ou protège (revue, porte, arbitre, découverte, règles des runs, liste
// noire, budget, hooks, workflows) reste sur main, derrière une PR.
//
// Les versions adoptées vivent sur la branche data, dans factory/brain/prompts/,
// avec l'empreinte du prompt de main dont elles partent : si main change, la
// version adoptée est ignorée (un humain a repris la main).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Pour chaque prompt : variables obligatoires et phrases qui doivent rester mot pour mot. */
export const ZONE = {
  spec: {
    vars: ["SLUG", "IDEA", "MAX_FEATURES", "MAX_ACCEPTANCE"],
    invariants: [
      "Si l'idée touche un sujet de la liste « Sujets interdits », n'écris pas de spec",
      "N'écris aucun autre fichier que `spec.json` et `report.json`.",
    ],
  },
  build: {
    vars: ["SPEC", "PREVIOUS"],
    invariants: [
      "N'installe aucun paquet, ne pousse rien, ne déploie rien.",
      "Ne modifie pas `spec.json`.",
      "Le pied de page légal est ajouté par l'usine à la publication : n'en écris pas.",
      "Chercher une chaîne dans le source n'est jamais un test.",
      "aucun `fetch`, WebSocket ou beacon",
    ],
  },
};

export const ZONE_NAMES = Object.keys(ZONE);

/** Texte ramené à sa forme canonique : sans caractères invisibles ni variantes Unicode. */
export function normalize(text) {
  return String(text)
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/g, "");
}

/**
 * Ce qu'une ligne ajoutée par le cerveau ne peut pas contenir : rien sur les
 * tests affichés, le juge ou l'annulation de consignes. Le but est de mieux
 * construire, pas de mieux passer les contrôles.
 */
const ADDED_LINE_DENY =
  /ok\s*AC|\b(revue|relecteur|relectrice|reviewer|review|score|note|bloquant|juge|porte|arbitre|caduque?s?|obsol[èe]tes?|ignore[rz]?|annule[rz]?|n'appliqu|ne s'applique|remplace[rz]? (les|la|cette) consigne|plus valable|pr[ée]c[ée]dentes? consignes?)\b/iu;

const FORBIDDEN = /ANTHROPIC|GOATCOUNTER|GITHUB|process\s*\.\s*env|\/proc\b|printenv|\benv\b|curl\b|wget\b|npm\s|npx\s|--no-verify|\.github|ff-count|goatcounter|base64|eval\s*\(/iu;

export function sha(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function defaultPrompt(root, name) {
  return readFileSync(join(root, "factory", "prompts", `${name}.md`), "utf8");
}

/** Lignes ajoutées et retirées entre deux versions : la taille réelle du changement. */
export function lineDiff(before, after) {
  const count = (t) => {
    const m = new Map();
    for (const l of t.split("\n")) if (l.trim()) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(before);
  const b = count(after);
  const added = [];
  let removed = 0;
  for (const [l, n] of b) for (let i = 0; i < n - (a.get(l) ?? 0); i++) added.push(l);
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) ?? 0));
  return { added, removed, total: added.length + removed };
}

/**
 * Contrôles d'un prompt candidat, par rapport au prompt de main et à la version
 * en vigueur. Renvoie les problèmes (vide = acceptable).
 */
export function checkPrompt(name, rawText, defaultText, { current = defaultText, maxChangedLines = Infinity } = {}) {
  const z = ZONE[name];
  if (!z) return [`prompt hors zone : ${name}`];
  if (typeof rawText !== "string") return ["prompt illisible"];
  const p = [];
  const text = normalize(rawText);
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/.test(rawText)) p.push("caractères invisibles");
  if (text.length > Math.max(8000, defaultText.length * 2)) p.push("prompt trop long");
  if (text.length < defaultText.length / 2) p.push("prompt trop court");
  const vars = [...text.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);
  for (const v of z.vars) if (!vars.includes(v)) p.push(`variable {{${v}}} manquante`);
  for (const v of new Set(vars)) if (!z.vars.includes(v)) p.push(`variable inconnue {{${v}}}`);
  for (const inv of z.invariants) if (!text.includes(inv)) p.push(`phrase obligatoire supprimée : « ${inv.slice(0, 60)}… »`);
  if (FORBIDDEN.test(text) && !FORBIDDEN.test(normalize(defaultText))) p.push("contenu interdit dans un prompt de production");
  const vsDefault = lineDiff(normalize(defaultText), text);
  for (const l of vsDefault.added) {
    // Lettres d'autres alphabets (homoglyphes) refusées dans les lignes ajoutées.
    if (ADDED_LINE_DENY.test(l) || FORBIDDEN.test(l) || /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(l)) {
      p.push(`ligne ajoutée refusée : « ${l.slice(0, 80)} »`);
      break;
    }
  }
  const vsCurrent = lineDiff(normalize(current), text);
  if (vsCurrent.total > maxChangedLines) p.push(`changement trop large : ${vsCurrent.total} lignes (max ${maxChangedLines})`);
  return p;
}

/** Prompt en vigueur : la version adoptée sur data si elle part du prompt de main actuel et passe les contrôles. */
export function zonePrompt(root, name) {
  const def = defaultPrompt(root, name);
  const dir = join(root, "factory", "brain", "prompts");
  const p = join(dir, `${name}.md`);
  if (!ZONE[name] || !existsSync(p)) return def;
  let meta = null;
  try {
    meta = JSON.parse(readFileSync(join(dir, `${name}.meta.json`), "utf8"));
  } catch {}
  if (meta?.baseSha !== sha(def)) {
    console.warn(`::notice::prompt adopté « ${name} » ignoré : le prompt de main a changé depuis`);
    return def;
  }
  const text = readFileSync(p, "utf8");
  const problems = checkPrompt(name, text, def, { current: text });
  if (problems.length) {
    console.warn(`::warning::prompt adopté « ${name} » ignoré : ${problems.join(", ")}`);
    return def;
  }
  return text;
}
