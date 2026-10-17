#!/usr/bin/env node
// report.mjs - The scores of /seo and /geo, computed on a fixed grid (grids.json) and kept in the
// project (.hypervibe/seo-report.json, versioned with the code), so that two passes compare and
// each skill sees what the other already checked (3.4.12). Until then the "Score X/Y" was judged
// by the model and moved from one pass to the next.
//
//   node report.mjs grid --skill seo|geo
//        the grid: each check, its weight, what it covers
//   node report.mjs record --skill seo|geo --file <results.json> [--web-dir <d>] [--site <url>]
//        records a pass: {"checks": {"<id>": {"status": "ok|warn|fail|na", "note": "..."}}}. Every
//        check of the grid is given a status (na when it does not apply), and none outside it.
//        Prints the score, and the one before on the same grid.
//   node report.mjs citations --file <results.json> [--web-dir <d>]
//        records /geo's guided check: {"questions": [{"question": "...", "results": {"<engine>":
//        "cited|not-cited|not-asked"}, "note": "..."}]}
//   node report.mjs show [--web-dir <d>]
//        what the project's report holds: each skill's last pass, its date and score
//
// Exit codes: 0 done, 1 an error (a file that cannot be read), 5 usage or results that do not
// match the grid. One JSON object on stdout.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXIT = { OK: 0, ERROR: 1, USAGE: 5 };
export const REPORT = join(".hypervibe", "seo-report.json");
const STATUSES = ["ok", "warn", "fail", "na"];
const ANSWERS = ["cited", "not-cited", "not-asked"];

export const loadGrids = (file = join(HERE, "grids.json")) => JSON.parse(readFileSync(file, "utf8"));

/** The score of a pass: points over the maximum, the checks that do not apply left out. */
export function score(grid, checks) {
  let points = 0;
  let max = 0;
  for (const c of grid.checks) {
    const s = checks[c.id]?.status;
    if (s === "na" || c.weight === 0) continue;
    max += c.weight;
    points += s === "ok" ? c.weight : s === "warn" ? c.weight / 2 : 0;
  }
  return { points, max, percent: max ? Math.round((points / max) * 100) : null };
}

/** Results against the grid: every check given a known status, none outside the grid. */
export function validate(grid, checks) {
  const problems = [];
  const ids = new Set(grid.checks.map((c) => c.id));
  for (const id of Object.keys(checks ?? {})) if (!ids.has(id)) problems.push(`"${id}" is not a check of the grid ${grid.id}`);
  for (const c of grid.checks) {
    const s = checks?.[c.id]?.status;
    if (!s) problems.push(`"${c.id}" has no status (na when it does not apply)`);
    else if (!STATUSES.includes(s)) problems.push(`"${c.id}": unknown status "${s}" (${STATUSES.join(", ")})`);
  }
  return problems;
}

const readReport = (webDir) => {
  const file = join(webDir, REPORT);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8"));
};
const writeReport = (webDir, report) => {
  const file = join(webDir, REPORT);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
};

/** Records a pass of a skill: {score, previous}. */
export function record(skill, results, { webDir = ".", site = null, today = new Date().toISOString().slice(0, 10), grids = loadGrids() } = {}) {
  const grid = grids[skill];
  if (!grid) throw Object.assign(new Error(`Unknown skill "${skill}" (seo, geo).`), { exit: EXIT.USAGE });
  const problems = validate(grid, results.checks);
  if (problems.length) throw Object.assign(new Error(`The results do not match the grid ${grid.id}: ${problems.join("; ")}.`), { exit: EXIT.USAGE, problems });
  const report = readReport(webDir);
  const before = report[skill];
  const now = { grid: grid.id, date: today, ...(site ? { site } : {}), score: score(grid, results.checks), checks: results.checks };
  // The pass before stays as the reference, on the same grid only (another grid is another scale);
  // a second pass the same day replaces the first and keeps the reference it had.
  let previous = null;
  if (before?.grid === grid.id) previous = before.date === today ? (before.previous ?? null) : { date: before.date, score: before.score };
  report.schema = 1;
  report[skill] = { ...now, previous, ...(skill === "geo" && before?.citations ? { citations: before.citations } : {}) };
  writeReport(webDir, report);
  return { skill, grid: grid.id, score: now.score, previous: report[skill].previous };
}

/** Records /geo's guided check of citations. */
export function citations(results, { webDir = ".", today = new Date().toISOString().slice(0, 10) } = {}) {
  const qs = results.questions;
  if (!Array.isArray(qs) || !qs.length) throw Object.assign(new Error("No question."), { exit: EXIT.USAGE });
  const bad = qs.filter((q) => !String(q.question ?? "").trim() || !q.results || Object.values(q.results).some((a) => !ANSWERS.includes(a)));
  if (bad.length) throw Object.assign(new Error(`Each question needs its text and, for each engine, ${ANSWERS.join(" | ")}.`), { exit: EXIT.USAGE });
  const report = readReport(webDir);
  report.schema = 1;
  report.geo = report.geo ?? {};
  const cited = qs.filter((q) => Object.values(q.results).includes("cited")).length;
  const previous = report.geo.citations ? { date: report.geo.citations.date, cited: report.geo.citations.cited, asked: report.geo.citations.questions.length } : null;
  report.geo.citations = { date: today, cited, questions: qs, previous };
  writeReport(webDir, report);
  return { cited, asked: qs.length, previous };
}

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1] ?? "";
      i += 1;
    } else out._.push(argv[i]);
  }
  return out;
}

async function main(argv) {
  const f = flags(argv);
  const verb = f._[0];
  const webDir = f["web-dir"] || ".";
  try {
    if (verb === "grid") {
      const grid = loadGrids()[f.skill];
      if (!grid) return { code: EXIT.USAGE, out: { ok: false, error: "grid --skill seo|geo" } };
      return { code: EXIT.OK, out: { ok: true, ...grid } };
    }
    if (verb === "show") {
      const r = readReport(webDir);
      const brief = (s) => (s ? { grid: s.grid, date: s.date, score: s.score, previous: s.previous ?? null, ...(s.citations ? { citations: { date: s.citations.date, cited: s.citations.cited, asked: s.citations.questions.length } } : {}) } : null);
      return { code: EXIT.OK, out: { ok: true, file: REPORT, seo: brief(r.seo), geo: brief(r.geo) } };
    }
    if (verb === "record" || verb === "citations") {
      if (!f.file || !existsSync(f.file)) return { code: EXIT.USAGE, out: { ok: false, error: `${verb} needs --file <results.json>.` } };
      const results = JSON.parse(readFileSync(f.file, "utf8"));
      const r = verb === "record" ? record(f.skill, results, { webDir, site: f.site || null }) : citations(results, { webDir });
      return { code: EXIT.OK, out: { ok: true, file: REPORT, ...r } };
    }
  } catch (e) {
    return { code: e.exit ?? EXIT.ERROR, out: { ok: false, error: e.message } };
  }
  return { code: EXIT.USAGE, out: { ok: false, error: "Usage: report.mjs grid --skill seo|geo | record --skill seo|geo --file <results.json> [--web-dir <d>] [--site <url>] | citations --file <results.json> [--web-dir <d>] | show [--web-dir <d>]" } };
}

// ─── Launched as a script, or imported ────────────────────────────────────────
// Node gives a module its real path and keeps in argv[1] the path as it was typed. Compared as
// they come, the two differ as soon as the plugin is reached through a symbolic link (macOS's
// temporary folder, a ~/.claude kept by a configuration repository): the script then did
// nothing and exited 0, "I could not" read as "nothing to report" (outside review, 3.3.9).
// Both are read to their real path. The same block in every script, held by
// scripts/tests/test-entry-point.mjs.
import { realpathSync as realPathOf } from "node:fs";
import { fileURLToPath as pathOfUrl } from "node:url";
function launchedDirectly() {
  try {
    if (!process.argv[1]) return false;
    const self = realPathOf(pathOfUrl(import.meta.url));
    const launched = realPathOf(process.argv[1]);
    return process.platform === "win32" ? self.toLowerCase() === launched.toLowerCase() : self === launched;
  } catch {
    return false;
  }
}
if (launchedDirectly()) {
  const { code, out } = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exitCode = code;
}
