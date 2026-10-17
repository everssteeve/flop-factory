#!/usr/bin/env node
// crawlers.mjs - The AI robots /geo knows, from ONE dated data file (ai-crawlers.json, 3.4.12):
// who runs each robot, what it does with a site (it fills an AI engine's search index, fetches a
// page while someone chats, or collects pages to train models), and the official page that says
// so. The skill names no robot itself: these lists change every quarter, and a skill that wrote
// them down would be wrong six months later. hypervibe-watch reads the official pages every week.
//
//   node crawlers.mjs list
//        the robots, the list's date, and whether it is due a re-check (`stale`)
//   node crawlers.mjs plan --strategy <s> [--block <t,...>] [--allow <t,...>]
//        which robots a strategy blocks: allow-all | cited-not-trained | block-all. A robot whose
//        blocking also takes away something the person may want (in its `whenBlocked`) stays
//        "ask" until --block or --allow names it
//   node crawlers.mjs apply --strategy <s> [--block ...] [--allow ...] [--web-dir <d>]
//        writes the rules: src/lib/robots-ai.ts, read by src/app/robots.ts; else a delimited block
//        in public/robots.txt. Refused while a robot is still "ask"
//   node crawlers.mjs audit (--url <site address> | --file <robots.txt>)
//        what a robots.txt says to each robot of the list, the retired names it still carries,
//        and the robots it does not name (they follow the rules written for all robots)
//
// A robot the rules do not name follows the group written for all robots (`User-agent: *`), so
// allowing a robot needs no line of its own: only the robots to block get a group (RFC 9309).
//
// Exit codes: 0 done, 1 an error (a robots.txt that could not be read, a file not found), 2 a
// decision is missing (a robot still "ask"), 5 usage. One JSON object on stdout.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_FILE = join(HERE, "ai-crawlers.json");
export const EXIT = { OK: 0, ERROR: 1, ASK: 2, USAGE: 5 };
export const ROLES = Object.freeze(["search-index", "user-fetch", "training", "opt-out-token"]);
export const STRATEGIES = Object.freeze(["allow-all", "cited-not-trained", "block-all"]);
const DAY = 24 * 60 * 60 * 1000;

/** The data file, read and checked: {checked, reviewEveryDays, crawlers, retired}. */
export function loadList(file = DATA_FILE) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.checked ?? ""))) throw new Error(`${file}: "checked" is not a date`);
  if (!Array.isArray(data.crawlers) || !data.crawlers.length) throw new Error(`${file}: no robot listed`);
  return data;
}

/** How old the list is, in whole days, and whether it is due a re-check. */
export function freshness(data, now = new Date()) {
  const ageDays = Math.floor((now.getTime() - Date.parse(`${data.checked}T00:00:00Z`)) / DAY);
  return { checked: data.checked, ageDays, stale: ageDays > (data.reviewEveryDays ?? 90) };
}

const tokenSet = (value) =>
  new Set(
    String(value ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );

/** Which robots a strategy blocks: {blocked, allowed, ask}, each a list of tokens. */
export function plan(data, strategy, { block = "", allow = "" } = {}) {
  if (!STRATEGIES.includes(strategy)) throw Object.assign(new Error(`Unknown strategy "${strategy}": ${STRATEGIES.join(" | ")}.`), { exit: EXIT.USAGE });
  const forced = { block: tokenSet(block), allow: tokenSet(allow) };
  const known = new Set(data.crawlers.map((c) => c.token.toLowerCase()));
  const unknown = [...forced.block, ...forced.allow].filter((t) => !known.has(t));
  if (unknown.length) throw Object.assign(new Error(`Not in the list: ${unknown.join(", ")}.`), { exit: EXIT.USAGE });
  const out = { strategy, blocked: [], allowed: [], ask: [] };
  for (const c of data.crawlers) {
    const t = c.token.toLowerCase();
    let decision = strategy === "allow-all" ? "allow" : strategy === "block-all" ? "block" : (c.strategy?.["cited-not-trained"] ?? "ask");
    if (forced.block.has(t)) decision = "block";
    if (forced.allow.has(t)) decision = "allow";
    (decision === "block" ? out.blocked : decision === "allow" ? out.allowed : out.ask).push(c.token);
  }
  return out;
}

// ─── robots.txt, read as RFC 9309 reads it ──────────────────────────────────
/** The groups of a robots.txt: [{agents, rules: [{allow, path}]}] and its sitemaps. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      if (current) current.rules.push({ allow: field === "allow", path: value });
    } else if (field === "sitemap") {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

/** Whether a robots.txt rule's path pattern matches `path` (`*` any run, `$` the end). */
function matches(pattern, path) {
  if (pattern === "") return false;
  let re = "";
  for (const ch of pattern) re += ch === "*" ? ".*" : ch === "$" ? "$" : ch.replace(/[.+?^{}()|[\]\\]/g, (x) => `\\${x}`);
  return new RegExp(`^${re}`).test(path);
}

/** What a robots.txt says to one robot about the site's root: {group, allowed}. The group is the
 *  robot's own when it is named ("own"), else the one for all robots ("all"), else none. */
export function verdict(parsed, token, path = "/") {
  const t = token.toLowerCase();
  let groups = parsed.groups.filter((g) => g.agents.includes(t));
  let group = "own";
  if (!groups.length) {
    groups = parsed.groups.filter((g) => g.agents.includes("*"));
    group = groups.length ? "all" : "none";
  }
  const rules = groups.flatMap((g) => g.rules).filter((r) => matches(r.path, path));
  if (!rules.length) return { group, allowed: true };
  const longest = Math.max(...rules.map((r) => r.path.length));
  const top = rules.filter((r) => r.path.length === longest);
  return { group, allowed: top.some((r) => r.allow) };
}

/** A robots.txt against the list: each robot's verdict, the retired names it carries. */
export function audit(data, text) {
  const parsed = parseRobots(text);
  const crawlers = data.crawlers.map((c) => ({ token: c.token, operator: c.operator, role: c.role, ...verdict(parsed, c.token) }));
  const named = new Set(parsed.groups.flatMap((g) => g.agents));
  const retired = (data.retired ?? []).filter((r) => named.has(r.token.toLowerCase())).map((r) => ({ token: r.token, operator: r.operator, replacedBy: r.replacedBy ?? [] }));
  return {
    crawlers,
    blocked: crawlers.filter((c) => !c.allowed).map((c) => c.token),
    notNamed: crawlers.filter((c) => c.group !== "own").map((c) => c.token),
    retired,
    sitemaps: parsed.sitemaps,
  };
}

// ─── Writing the rules ──────────────────────────────────────────────────────
const BEGIN = "# BEGIN AI robots";
const END = "# END AI robots";
export const RULES_FILE = "src/lib/robots-ai.ts";
const RULES_IMPORT = 'import { aiRobotRules } from "~/lib/robots-ai";';

function header(data, p, today) {
  return `generated by Hypervibe /geo on ${today}, from its list of AI robots checked on ${data.checked}; strategy: ${p.strategy}. Run /geo again to update it: the robots change every quarter.`;
}

/** src/lib/robots-ai.ts: the groups that block, as Next.js's robots.ts takes them. */
export function rulesSource(data, p, today) {
  const blocked = p.blocked.map((t) => JSON.stringify(t)).join(", ");
  const record = JSON.stringify({ strategy: p.strategy, generated: today, listChecked: data.checked, blocked: p.blocked });
  return `// The rules for AI robots, read by src/app/robots.ts: ${header(data, p, today)}
// A robot not named here follows the rules written for all robots.
// hypervibe-ai-robots: ${record}
import type { MetadataRoute } from "next";

export const aiRobotRules: Extract<MetadataRoute.Robots["rules"], unknown[]> = ${p.blocked.length ? `[\n  { userAgent: [${blocked}], disallow: "/" },\n]` : "[]"};
`;
}

/** The block written into a static public/robots.txt, between its two markers. */
export function robotsTxtBlock(data, p, today) {
  const lines = [`${BEGIN} - ${header(data, p, today)}`];
  if (p.blocked.length) {
    for (const t of p.blocked) lines.push(`User-agent: ${t}`);
    lines.push("Disallow: /");
  } else {
    lines.push("# No AI robot is blocked: they all follow the rules written for all robots.");
  }
  lines.push(END);
  return lines.join("\n");
}

/** Writes the rules into the project: {written, wired, ...}. */
export function apply(data, p, { webDir = ".", today = new Date().toISOString().slice(0, 10) } = {}) {
  if (p.ask.length) throw Object.assign(new Error(`A decision is missing for: ${p.ask.join(", ")} (--block or --allow).`), { exit: EXIT.ASK, ask: p.ask });
  const robotsTs = join(webDir, "src", "app", "robots.ts");
  const robotsTxt = join(webDir, "public", "robots.txt");
  if (existsSync(robotsTs)) {
    const file = join(webDir, RULES_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, rulesSource(data, p, today));
    let source = readFileSync(robotsTs, "utf8");
    if (source.includes("...aiRobotRules")) return { written: RULES_FILE, wired: true, already: true, blocked: p.blocked };
    const anchor = /rules:\s*\[\s*\{\s*userAgent:\s*"\*"/;
    if (!anchor.test(source)) {
      return { written: RULES_FILE, wired: false, blocked: p.blocked, todo: "src/app/robots.ts does not have the expected shape: add `...aiRobotRules` at the head of its rules list, and import it from ~/lib/robots-ai." };
    }
    source = source.replace(anchor, (m) => m.replace("[", "[...aiRobotRules, "));
    let end = -1;
    for (const im of source.matchAll(/^import\b[^;]*;/gm)) end = im.index + im[0].length;
    source = end < 0 ? `${RULES_IMPORT}\n${source}` : `${source.slice(0, end)}\n${RULES_IMPORT}${source.slice(end)}`;
    writeFileSync(robotsTs, source);
    return { written: RULES_FILE, wired: true, blocked: p.blocked };
  }
  if (existsSync(robotsTxt)) {
    const text = readFileSync(robotsTxt, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    const a = lines.findIndex((l) => l.startsWith(BEGIN));
    const b = lines.findIndex((l, i) => i > a && l.startsWith(END));
    const block = robotsTxtBlock(data, p, today).split("\n");
    let next;
    if (a >= 0 && b > a) next = [...lines.slice(0, a), ...block, ...lines.slice(b + 1)];
    else next = [...block, "", ...lines];
    // A robot also named outside the block: the rules of every group that names it are combined.
    const outside = parseRobots([...lines.slice(0, a >= 0 && b > a ? a : 0), ...lines.slice(a >= 0 && b > a ? b + 1 : 0)].join("\n"));
    const namedTwice = data.crawlers.map((c) => c.token).filter((t) => outside.groups.some((g) => g.agents.includes(t.toLowerCase())));
    writeFileSync(robotsTxt, next.join(eol));
    return { written: "public/robots.txt", wired: true, blocked: p.blocked, ...(namedTwice.length ? { namedTwice } : {}) };
  }
  throw Object.assign(new Error("No robots.txt in the project (neither src/app/robots.ts nor public/robots.txt): /seo creates it."), { exit: EXIT.ERROR });
}

// ─── CLI ────────────────────────────────────────────────────────────────────
function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1] ?? "";
      i += 1;
    } else out._.push(a);
  }
  return out;
}

async function main(argv) {
  const f = flags(argv);
  const verb = f._[0];
  if (!["list", "plan", "apply", "audit"].includes(verb)) {
    return { code: EXIT.USAGE, out: { ok: false, error: "Usage: crawlers.mjs list | plan --strategy <s> [--block t,..] [--allow t,..] | apply --strategy <s> [...] [--web-dir <d>] | audit (--url <site> | --file <robots.txt>)" } };
  }
  const data = loadList();
  const fresh = freshness(data);
  if (verb === "list") {
    const strip = ({ sources, ...c }) => ({ ...c, sources: (sources ?? []).map((s) => s.url) });
    return { code: EXIT.OK, out: { ok: true, ...fresh, crawlers: data.crawlers.map(strip), retired: data.retired ?? [] } };
  }
  if (verb === "audit") {
    let text;
    if (f.file) {
      if (!existsSync(f.file)) return { code: EXIT.ERROR, out: { ok: false, error: `No file ${f.file}.` } };
      text = readFileSync(f.file, "utf8");
    } else if (f.url) {
      const url = `${String(f.url).replace(/\/+$/, "")}/robots.txt`;
      let res;
      try {
        res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
      } catch (e) {
        return { code: EXIT.ERROR, out: { ok: false, error: `${url} could not be reached (${e.message}): nothing can be said of it.` } };
      }
      if (res.status === 404) text = "";
      else if (!res.ok) return { code: EXIT.ERROR, out: { ok: false, error: `${url} answered HTTP ${res.status}: nothing can be said of it.` } };
      else text = await res.text();
    } else return { code: EXIT.USAGE, out: { ok: false, error: "audit needs --url <site address> or --file <robots.txt>." } };
    return { code: EXIT.OK, out: { ok: true, ...fresh, ...audit(data, text) } };
  }
  try {
    const p = plan(data, f.strategy, { block: f.block, allow: f.allow });
    if (verb === "plan") return { code: p.ask.length ? EXIT.ASK : EXIT.OK, out: { ok: !p.ask.length, ...fresh, ...p } };
    const r = apply(data, p, { webDir: f["web-dir"] || "." });
    return { code: EXIT.OK, out: { ok: true, ...fresh, strategy: p.strategy, ...r } };
  } catch (e) {
    return { code: e.exit ?? EXIT.ERROR, out: { ok: false, error: e.message, ...(e.ask ? { ask: e.ask } : {}) } };
  }
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
