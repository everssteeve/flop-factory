#!/usr/bin/env node
// test-skill-pipelines.mjs - What a skill reads as a success is the step's own status, and the
// conversion into a monorepo leaves the repository's own files where they are read.
//
// Two defects published until 3.4.1 (lot 6 bis, 05/10/2026):
//   - /add-domain announced a Worker "redeployed" when its deployment had failed: the status it
//     read was the one of `tail`, at the end of the pipeline, which is always 0;
//   - the conversion into a monorepo moved everything into apps/web/, the repository's
//     automations, its resource manifest and its ignore file included, then staged the whole
//     tree: the forge no longer read the automations, a second manifest was born at the root,
//     and an .env left at the root was covered by no ignore file of the project.
// No network: the skills are read.
//
//   node scripts/tests/test-skill-pipelines.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${String(detail).slice(0, 300)})` : ""}`);
}

console.log("── Un déploiement lu à travers un tube ──");
const offenders = [];
let seen = 0;
for (const skill of readdirSync(join(ROOT, "skills"))) {
  const file = join("skills", skill, "SKILL.md");
  if (!existsSync(join(ROOT, file))) continue;
  read(file).split("\n").forEach((line, i) => {
    // A deployment whose output is cut by tail or head, its status then read by && or ||.
    if (/\bdeploy\b[^|]*\|\s*(tail|head)\b/.test(line)) {
      seen += 1;
      if (!/pipefail/.test(line)) offenders.push(`${file}:${i + 1}`);
    }
  });
}
check("no skill reads a deployment's success on the status of tail or head (pipefail)", offenders.length === 0, offenders.join(", "));
if (existsSync(join(ROOT, "skills", "add-domain", "SKILL.md"))) {
  check("... and /add-domain's redeployment of a Worker is among those read", seen > 0 && /set -o pipefail;[^\n]*wrangler deploy/.test(read("skills", "add-domain", "SKILL.md")));
}

const CONVERT = join("skills", "_convert-to-turborepo", "SKILL.md");
if (existsSync(join(ROOT, CONVERT))) {
  console.log("\n── La conversion en monorepo ──");
  const text = read(CONVERT);
  const step = (title) => text.slice(text.indexOf(title), text.indexOf("\n## ", text.indexOf(title) + 1));
  const move = step("## Step 4");
  const stay = /case "\$item" in\n\s*([^)]*)\) continue ;;/.exec(move)?.[1]?.split("|") ?? [];
  for (const kept of [".github", ".hypervibe", ".claude", "CLAUDE.md", ".gitignore", ".npmrc", "pnpm-lock.yaml"]) {
    check(`the conversion leaves ${kept} at the repository's root`, stay.includes(kept), stay.join("|"));
  }
  check("only what git tracks moves with git mv, decided per item", /git ls-files --error-unmatch -- "\$item"/.test(move) && /git mv -- "\$item" "apps\/web\/\$item"/.test(move));
  check("the application's .env and .vercel follow it with a plain mv, never through git", /\.env\|\.env\.\*\|\.vercel\) mv -- "\$item" "apps\/web\/\$item"/.test(move));
  check("the ignore file is copied into apps/web, the root one stays", /cp \.gitignore apps\/web\/\.gitignore/.test(move));
  const commit = step("## Step 11");
  check("the commit never stages the whole tree (no git add -A, no git add .)", !/git add (-A|--all|\.)(\s|$)/m.test(commit));
  check("... only the tracked files in bulk (-u, never a new file), the rest by name", /HYPERVIBE_GUARD_ALLOW_SWEEP=1 git add -u\n/.test(commit) && /git add -- package\.json pnpm-workspace\.yaml turbo\.json apps\/web\/\.gitignore/.test(commit));
  check("the person is told to point the site's hosting at apps/web before any push", /Root Directory[^\n]*apps\/web/.test(step("## Step 12")) && /before the next push/i.test(step("## Step 12")));
}

const ADD_DOMAIN = join("skills", "add-domain", "SKILL.md");
if (existsSync(join(ROOT, ADD_DOMAIN))) {
  // A registrar's sub-skill no row leads to is never run (LWS joined in 3.4.10 / 2.4.9): the
  // person would be guided by hand at a registrar the harness knows how to drive.
  console.log("\n── Chaque prestataire de domaine a sa route ──");
  const routed = new Set([...read(ADD_DOMAIN).matchAll(/^\|\s*`[a-z]+`\s*\|\s*`(_dns-[a-z-]+)`/gm)].map((m) => m[1]));
  // A registrar's sub-skill is the one that changes nameservers, and its description says so; the
  // others (an email sender's records) are called by /add-domain on steps of their own.
  const description = (d) => /^description:(.*)$/m.exec(read("skills", d, "SKILL.md"))?.[1] ?? "";
  const registrars = readdirSync(join(ROOT, "skills")).filter((d) => d.startsWith("_dns-") && existsSync(join(ROOT, "skills", d, "SKILL.md")) && /nameserver/i.test(description(d)));
  const unrouted = registrars.filter((d) => !routed.has(d));
  check("every registrar's sub-skill has its row in /add-domain's routing table", registrars.length > 0 && unrouted.length === 0, unrouted.join(", "));
  const missing = [...routed].filter((d) => !existsSync(join(ROOT, "skills", d, "SKILL.md")));
  check("... and every row of that table leads to a sub-skill that exists", routed.size > 0 && missing.length === 0, missing.join(", "));
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
