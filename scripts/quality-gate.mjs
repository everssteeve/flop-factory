#!/usr/bin/env node
// Porte qualité de la phase Socle, exécutée par le workflow et non par l'agent.
//   node scripts/quality-gate.mjs work/hello
// Sortie 1 au premier contrôle qui échoue.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const SECRET_PATTERNS = [
  { id: "anthropic", re: /sk-ant-[A-Za-z0-9_-]{10,}/ },
  { id: "stripe-live", re: /\b(sk|rk)_live_[A-Za-z0-9]{8,}/ },
  { id: "github", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "aws", re: /\bAKIA[0-9A-Z]{16}\b/ },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

export function scanSecrets(dir) {
  const hits = [];
  for (const p of files(dir)) {
    const text = readFileSync(p, "utf8");
    for (const { id, re } of SECRET_PATTERNS) if (re.test(text)) hits.push({ file: p, pattern: id });
  }
  return hits;
}

export function checkSite(dir) {
  const problems = [];
  for (const f of ["index.html", "style.css", "test.mjs"]) {
    if (!existsSync(join(dir, f))) problems.push(`${f} manquant`);
  }
  if (problems.length) return problems;
  const html = readFileSync(join(dir, "index.html"), "utf8");
  if (!/<title>[^<]+<\/title>/i.test(html)) problems.push("pas de <title>");
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) problems.push("pas de meta viewport");
  if (!/href=["']style\.css["']/i.test(html)) problems.push("style.css non lié");
  if (/localhost|127\.0\.0\.1/i.test(html)) problems.push("lien localhost dans la page");
  if (/<script[^>]+src=["']https?:/i.test(html)) problems.push("script externe interdit");
  return problems;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dir = resolve(process.argv[2] ?? ".");
  const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  if (report.status !== "ok") {
    console.error(`rapport de l'agent : ${report.status}`);
    process.exit(1);
  }
  const problems = checkSite(dir);
  const secrets = scanSecrets(dir);
  for (const s of secrets) problems.push(`secret possible (${s.pattern}) dans ${s.file}`);
  if (!problems.length) {
    const t = spawnSync("node", ["test.mjs"], { cwd: dir, encoding: "utf8", timeout: 60_000, env: { PATH: process.env.PATH } });
    if (t.status !== 0) problems.push(`test.mjs échoue : ${(t.stderr || t.stdout).slice(-500)}`);
  }
  if (problems.length) {
    console.error("Porte qualité refusée :\n- " + problems.join("\n- "));
    process.exit(1);
  }
  console.log("Porte qualité : ok");
}
