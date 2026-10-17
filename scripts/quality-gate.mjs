#!/usr/bin/env node
// Porte qualité, exécutée par le workflow sur un checkout neuf, jamais par
// l'agent. Elle ne croit ni son rapport ni sa revue : elle revalide la spec,
// contrôle les fichiers, rejoue test.mjs en sandbox et charge l'app dans un
// navigateur. Elle ne décide pas de la publication : l'arbitre le fait.
//
//   node scripts/quality-gate.mjs <app-dir> <out-dir>
//
// <app-dir> : sortie de la chaîne (fichiers de l'app, spec.json, review.json).
// <out-dir> : gate.json, spec.json, review.json et site/ (fichiers publiables).
// Sortie 0 dès que gate.json est écrit, même si l'app est refusée.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/budget.mjs";
import { loadIdeas, validateSpec } from "./lib/apps.mjs";
import { collectFiles, copyAccepted, NEVER_PUBLISHED } from "./lib/site-files.mjs";
import { runSandboxed } from "./lib/sandbox.mjs";
import { normalizeReview } from "./pipeline.mjs";
import { harden } from "./lib/harden.mjs";

export const SECRET_PATTERNS = [
  { id: "anthropic", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { id: "stripe-live", re: /\b(sk|rk)_live_[A-Za-z0-9]{8,}/ },
  { id: "github", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "aws", re: /\bAKIA[0-9A-Z]{16}\b/ },
];

export function scanSecrets(dir, files) {
  const hits = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const { id, re } of SECRET_PATTERNS) if (re.test(text)) hits.push({ file: f, pattern: id });
  }
  return hits;
}

const EXTERNAL_TAG = /<(script|link|img|iframe|source|video|audio|embed|object|form)\b[^>]*\b(src|href|action|data)\s*=\s*["']?\s*(https?:)?\/\//i;
const EXTERNAL_CSS = /(@import|url\()\s*["']?\s*(https?:)?\/\//i;

/** Contrôles statiques des fichiers publiables. */
export function checkSite(dir, files) {
  const problems = [];
  for (const f of ["index.html", "style.css", "app.js", "test.mjs"]) if (!files.includes(f)) problems.push(`${f} manquant`);
  if (problems.length) return problems;
  const html = readFileSync(join(dir, "index.html"), "utf8");
  if (!/<head(\s[^>]*)?>/i.test(html)) problems.push("pas de <head>");
  if (/http-equiv\s*=\s*["']?content-security-policy/i.test(html)) problems.push("politique de sécurité propre interdite (l'usine impose la sienne)");
  if (/<base\b/i.test(html)) problems.push("balise <base> interdite");
  if (!/<title>[^<]*\S[^<]*<\/title>/i.test(html)) problems.push("pas de <title>");
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) problems.push("pas de meta viewport");
  if (!/<html[^>]+lang=["']fr/i.test(html)) problems.push("langue de la page non déclarée en français");
  if (!/href=["']\.?\/?style\.css["']/i.test(html)) problems.push("style.css non lié");
  if (!/<script[^>]+src=["']\.?\/?app\.js["']/i.test(html)) problems.push("app.js non chargé");
  if (/localhost|127\.0\.0\.1/i.test(html)) problems.push("lien localhost dans la page");
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    if (f.endsWith(".html") && EXTERNAL_TAG.test(text)) problems.push(`ressource externe dans ${f}`);
    if (f.endsWith(".css") && EXTERNAL_CSS.test(text)) problems.push(`ressource externe dans ${f}`);
    if (/document\.cookie/.test(text)) problems.push(`cookie dans ${f}`);
    if (/\b(WebSocket|RTCPeerConnection|sendBeacon|EventSource|importScripts)\b/.test(text)) problems.push(`API réseau interdite dans ${f}`);
  }
  return problems;
}

/** Rejoue test.mjs en sandbox ; chaque critère doit afficher sa ligne `ok AC-n`. */
export function checkAcceptance(dir, spec) {
  const r = runSandboxed(dir, ["test.mjs"]);
  if (r.infra) return { problems: [`test.mjs : ${r.error}`], seen: [], infra: true };
  if (r.error) return { problems: [`test.mjs : ${r.error}`], seen: [] };
  const seen = [...new Set([...r.stdout.matchAll(/^ok (AC-\d+)\s*$/gm)].map((m) => m[1]))];
  const problems = [];
  if (r.status !== 0) problems.push(`test.mjs échoue (code ${r.status}) : ${(r.stderr || r.stdout).slice(-400)}`);
  for (const a of spec.acceptance) if (!seen.includes(a.id)) problems.push(`critère ${a.id} non vérifié par test.mjs`);
  return { problems, seen };
}

export async function runGate(appDir, outDir, root, { browser } = {}) {
  const config = loadConfig(root);
  const limits = config.pipeline;
  const problems = [];
  const spec = JSON.parse(readFileSync(join(appDir, "spec.json"), "utf8"));
  const idea = loadIdeas(root).find((i) => i.slug === spec?.slug);
  if (!idea) throw new Error(`app inconnue de factory/ideas.json : ${spec?.slug}`);
  const specProblems = validateSpec(spec, idea, config);
  if (specProblems.length) problems.push(...specProblems.map((p) => `spec : ${p}`));
  const review = normalizeReview(existsSync(join(appDir, "review.json")) ? JSON.parse(readFileSync(join(appDir, "review.json"), "utf8")) : null);

  rmSync(outDir, { recursive: true, force: true });
  const site = join(outDir, "site");
  const { files, problems: fileProblems } = collectFiles(appDir, limits);
  problems.push(...fileProblems);
  let seen = [];
  let infra = false;
  if (!fileProblems.length) {
    copyAccepted(appDir, site, limits, NEVER_PUBLISHED);
    const published = files.filter((f) => !NEVER_PUBLISHED.has(f));
    problems.push(...checkSite(site, published));
    for (const s of scanSecrets(site, published)) problems.push(`secret possible (${s.pattern}) dans ${s.file}`);
    if (!specProblems.length && !problems.length) {
      // La page testée est celle qui sera publiée : politique de sécurité de l'usine comprise.
      writeFileSync(join(site, "index.html"), harden(readFileSync(join(site, "index.html"), "utf8")));
      const acc = checkAcceptance(site, spec);
      seen = acc.seen;
      infra = Boolean(acc.infra);
      problems.push(...acc.problems);
    }
    if (!problems.length) {
      const smoke = await (browser ?? (await import("./lib/browser-smoke.mjs")).browserSmoke)(site);
      if (smoke.some((p) => p.startsWith("navigateur indisponible"))) infra = true;
      problems.push(...smoke);
    }
  }

  mkdirSync(outDir, { recursive: true });
  // infra : la porte n'a pas pu juger (sandbox ou navigateur absents). L'arbitre ne compte pas la tentative.
  const gate = { slug: idea.slug, passed: problems.length === 0, infra, problems: problems.slice(0, 50), acceptanceSeen: seen };
  writeFileSync(join(outDir, "gate.json"), JSON.stringify(gate, null, 2) + "\n");
  writeFileSync(join(outDir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
  writeFileSync(join(outDir, "review.json"), JSON.stringify(review, null, 2) + "\n");
  if (!gate.passed) rmSync(site, { recursive: true, force: true });
  return gate;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [appDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
  const gate = await runGate(appDir, outDir, root);
  console.log(gate.passed ? `Porte qualité : ok (${gate.slug})` : `Porte qualité refusée (${gate.slug}) :\n- ${gate.problems.join("\n- ")}`);
}
