// État des apps de l'usine et validation des specs. Code pur, sans modèle :
// c'est la partie de la chaîne qui ne doit jamais croire ce qu'un agent écrit.
//
// Sur la branche data :
//   factory/apps/<slug>.json   état de l'app (building | live | abandoned)
//   apps/<slug>/...            fichiers publiés de l'app validée

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const AC_ID = /^AC-[1-9][0-9]?$/;
export const STATUSES = ["building", "live", "abandoned", "killed"];

/** Idées posées à la main (main), puis idées découvertes par l'usine (branche data), dans cet ordre. */
export function loadIdeas(root) {
  const { ideas: curated } = JSON.parse(readFileSync(join(root, "factory", "ideas.json"), "utf8"));
  const dp = join(root, "factory", "ideas-discovered.json");
  const curatedSlugs = new Set(curated.map((i) => i.slug));
  // Une idée découverte qui reprend un slug posé à la main, ou mal formée, est ignorée :
  // elle ne doit jamais bloquer l'usine.
  const discovered = (existsSync(dp) ? JSON.parse(readFileSync(dp, "utf8")).ideas : []).filter(
    (i) => i && !curatedSlugs.has(i.slug) && SLUG.test(i.slug ?? "") && i.slug.length <= 30 && typeof i.idea === "string" && i.idea.length >= 20 && i.idea.length <= 600,
  );
  const ideas = [...curated];
  const seen = new Set();
  for (const i of discovered) if (!seen.has(i.slug)) { seen.add(i.slug); ideas.push(i); }
  seen.clear();
  for (const i of ideas) {
    if (!SLUG.test(i.slug) || i.slug.length > 30) throw new Error(`slug d'idée invalide : ${i.slug}`);
    if (seen.has(i.slug)) throw new Error(`idée en double : ${i.slug}`);
    if (typeof i.idea !== "string" || i.idea.length < 20 || i.idea.length > 600) throw new Error(`idée mal formée : ${i.slug}`);
    seen.add(i.slug);
  }
  return ideas;
}

/**
 * Motif de la liste noire → expression régulière. `\b` y marque une frontière de
 * mot qui tient compte des lettres accentuées (le `\b` de JavaScript ne les voit pas).
 */
export function keywordRegex(k) {
  return new RegExp(k.replace(/^\\b/, "(?<!\\p{L})").replace(/\\b$/, "(?!\\p{L})").replace(/\\b/g, "(?<!\\p{L})"), "iu");
}

/** Une idée trouvée sur le web passe-t-elle les filtres de l'usine ? Renvoie les problèmes. */
export function checkDiscovered(c, knownSlugs, blocklist) {
  const p = [];
  if (!c || typeof c !== "object") return ["idée illisible"];
  const keys = Object.keys(c).sort().join(",");
  if (keys !== "evidence,idea,slug") p.push(`champs inattendus : ${keys}`);
  if (typeof c.slug !== "string" || !SLUG.test(c.slug) || c.slug.length < 3 || c.slug.length > 30) p.push(`slug invalide : ${c.slug}`);
  else if (knownSlugs.has(c.slug)) p.push(`déjà connue : ${c.slug}`);
  if (typeof c.idea !== "string" || c.idea.length < 40 || c.idea.length > 400) p.push("idée : 40 à 400 caractères");
  if (typeof c.evidence !== "string" || c.evidence.length < 10 || c.evidence.length > 300) p.push("evidence : 10 à 300 caractères");
  const text = `${c.slug} ${c.idea} ${c.evidence}`;
  for (const k of blocklist.keywords ?? []) if (keywordRegex(k).test(text)) p.push(`sujet interdit (${k})`);
  // Le texte d'une idée finit dans les prompts d'agents qui ont un shell : une ligne,
  // des caractères ordinaires, rien qui ressemble à un lien, une balise ou une consigne.
  for (const [field, v] of [["idée", c.idea], ["evidence", c.evidence]]) {
    if (typeof v !== "string") continue;
    if (/https?:|www\.|[<>{}\[\]`#|\\$]/.test(v)) p.push(`${field} : ni lien, ni balise, ni code`);
    if (!/^[\p{L}\p{N} .,;:!?'’()«»"\-–/%°+&]*$/u.test(v)) p.push(`${field} : caractères non autorisés`);
    if (/(?<!\p{L})(instructions?|ignore[rz]?|consignes?|prompt|syst[èe]me|cl[ée]s?|api|token|secrets?|env|variables? d'environnement|mot de passe|password|assistant|claude|ia)(?!\p{L})/iu.test(v))
      p.push(`${field} : vocabulaire de consigne refusé`);
  }
  return p;
}

export function newState(slug) {
  return { slug, status: "building", attempts: 0, liveSince: null, history: [] };
}

export function readStates(dir) {
  const states = {};
  const d = join(dir, "factory", "apps");
  if (!existsSync(d)) return states;
  for (const f of readdirSync(d)) {
    if (!f.endsWith(".json")) continue;
    const s = JSON.parse(readFileSync(join(d, f), "utf8"));
    states[s.slug] = s;
  }
  return states;
}

/** Prochaine idée à construire : la première ni en ligne, ni abandonnée. */
export function pickIdea(ideas, states, maxAttempts) {
  for (const i of ideas) {
    const s = states[i.slug];
    if (!s) return i;
    if (s.status === "building" && s.attempts < maxAttempts) return i;
  }
  return null;
}

function text(v, min, max) {
  return typeof v === "string" && v.trim().length >= min && v.length <= max;
}

/**
 * Valide une spec écrite par l'atelier Spec. Renvoie la liste des problèmes
 * (vide si la spec est acceptée). Le slug doit être celui de l'idée choisie.
 */
export function validateSpec(spec, idea, config) {
  const p = [];
  const max = config.pipeline;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return ["spec illisible"];
  const allowed = new Set(["slug", "name", "pitch", "problem", "audience", "features", "acceptance", "outOfScope"]);
  for (const k of Object.keys(spec)) if (!allowed.has(k)) p.push(`champ inattendu : ${k}`);
  if (spec.slug !== idea.slug) p.push(`slug ${JSON.stringify(spec.slug)} au lieu de ${idea.slug}`);
  if (!text(spec.name, 3, 40)) p.push("name : 3 à 40 caractères");
  if (!text(spec.pitch, 10, 160)) p.push("pitch : 10 à 160 caractères");
  if (!text(spec.problem, 10, 400)) p.push("problem : 10 à 400 caractères");
  if (!text(spec.audience, 3, 200)) p.push("audience : 3 à 200 caractères");
  if (!Array.isArray(spec.features) || spec.features.length < 1 || spec.features.length > max.maxFeatures || !spec.features.every((f) => text(f, 5, 200)))
    p.push(`features : 1 à ${max.maxFeatures} phrases`);
  if (spec.outOfScope !== undefined && (!Array.isArray(spec.outOfScope) || !spec.outOfScope.every((f) => text(f, 3, 200)))) p.push("outOfScope : liste de phrases");
  if (!Array.isArray(spec.acceptance) || spec.acceptance.length < 2 || spec.acceptance.length > max.maxAcceptance) {
    p.push(`acceptance : 2 à ${max.maxAcceptance} critères`);
  } else {
    const ids = new Set();
    for (const a of spec.acceptance) {
      if (!a || !AC_ID.test(a.id) || ids.has(a.id)) p.push(`critère : identifiant invalide ou en double (${a?.id})`);
      else ids.add(a.id);
      if (!text(a?.given, 3, 300) || !text(a?.when, 3, 300) || !text(a?.then, 3, 300)) p.push(`critère ${a?.id} : given, when, then requis`);
      const keys = Object.keys(a ?? {}).sort().join(",");
      if (keys !== "given,id,then,when") p.push(`critère ${a?.id} : champs inattendus`);
    }
  }
  return p;
}

/** Échappe un texte venu d'une spec avant de l'insérer dans une page. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
