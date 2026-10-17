#!/usr/bin/env node
// test-geo.mjs - /geo's tools (3.4.12): the dated list of AI robots (its shape, every entry
// sourced), the robots.txt rules built from it for each strategy, a robots.txt read as RFC 9309
// reads it, the rules written into a project (src/app/robots.ts, or a static robots.txt, twice in
// a row), a page fetched as AI robots receive it (its text in the HTML or drawn by JavaScript, a
// firewall that turns them away), and the skill that names no robot itself. Nothing reaches the
// network: the pages are served on the loopback.
//
//   node scripts/tests/test-geo.mjs

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const crawlers = await load("scripts/geo/crawlers.mjs");
const fetchAsAi = await load("scripts/geo/fetch-as-ai.mjs");

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 400)})`}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. The list itself ──────────────────────────────────────────────────────
console.log("── La liste des robots d'IA ──");
const data = crawlers.loadList();
{
  const tokens = data.crawlers.map((c) => c.token.toLowerCase());
  check("dated (checked), with a delay before its next reading (reviewEveryDays)", /^\d{4}-\d{2}-\d{2}$/.test(data.checked) && Number.isInteger(data.reviewEveryDays) && data.reviewEveryDays > 0 && data.reviewEveryDays <= 180);
  check("no robot twice", new Set(tokens).size === tokens.length);
  const bad = data.crawlers.filter(
    (c) =>
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(c.token) ||
      !c.operator ||
      !crawlers.ROLES.includes(c.role) ||
      ![true, false, "user-initiated"].includes(c.honorsRobotsTxt) ||
      !String(c.whenBlocked ?? "").trim() ||
      !["allow", "block", "ask"].includes(c.strategy?.["cited-not-trained"]) ||
      !Array.isArray(c.sources) ||
      !c.sources.length ||
      c.sources.some((s) => !/^https:\/\//.test(s.url) || !String(s.says ?? "").trim()),
  );
  check("every robot: its exact name, its operator, its role, its word on robots.txt, what blocking it means, its default, and an official source with what it says", bad.length === 0, bad.map((c) => c.token).join(", "));
  const badAgent = data.crawlers.filter((c) => c.userAgent !== null && (typeof c.userAgent !== "string" || !c.userAgent.toLowerCase().includes(c.token.toLowerCase().replace(/;$/, ""))));
  check("a full user-agent string, when the operator publishes one, carries the robot's name (null otherwise, never invented)", badAgent.length === 0, badAgent.map((c) => c.token).join(", "));
  const trained = data.crawlers.filter((c) => c.role === "training" && c.strategy["cited-not-trained"] !== "block");
  const cited = data.crawlers.filter((c) => (c.role === "search-index" || c.role === "user-fetch") && c.strategy["cited-not-trained"] !== "allow");
  check("\"cited, not trained\" blocks what trains and lets in what cites", trained.length === 0 && cited.length === 0, [...trained, ...cited].map((c) => c.token).join(", "));
  const retired = data.retired ?? [];
  check("a retired name is no longer listed as a robot, and says what replaced it, with its source", retired.every((r) => !tokens.includes(r.token.toLowerCase()) && Array.isArray(r.replacedBy) && r.sources?.length));
  const fresh = crawlers.freshness(data, new Date(Date.parse(`${data.checked}T00:00:00Z`) + (data.reviewEveryDays + 1) * 86400000));
  check("past its delay, the list says it is due a reading (stale)", fresh.stale === true && crawlers.freshness(data, new Date(`${data.checked}T12:00:00Z`)).stale === false);
}

// ── 2. The strategies ───────────────────────────────────────────────────────
console.log("\n── Les trois options ──");
const FIXTURE = {
  checked: "2026-10-14",
  reviewEveryDays: 90,
  crawlers: [
    { token: "IndexBot", operator: "A", role: "search-index", strategy: { "cited-not-trained": "allow" } },
    { token: "Chat-User", operator: "A", role: "user-fetch", strategy: { "cited-not-trained": "allow" } },
    { token: "TrainBot", operator: "B", role: "training", strategy: { "cited-not-trained": "block" } },
    { token: "Both-Extended", operator: "C", role: "opt-out-token", strategy: { "cited-not-trained": "ask" } },
  ],
  retired: [{ token: "old-bot", operator: "B", replacedBy: ["TrainBot"] }],
};
{
  let p = crawlers.plan(FIXTURE, "allow-all");
  check("allow all: nobody blocked, nothing to ask", p.blocked.length === 0 && p.ask.length === 0);
  p = crawlers.plan(FIXTURE, "block-all");
  check("block all: every robot blocked", same(p.blocked, ["IndexBot", "Chat-User", "TrainBot", "Both-Extended"]));
  p = crawlers.plan(FIXTURE, "cited-not-trained");
  check("cited, not trained: what trains blocked, what cites allowed, the double-edged one asked", same(p.blocked, ["TrainBot"]) && same(p.allowed, ["IndexBot", "Chat-User"]) && same(p.ask, ["Both-Extended"]));
  p = crawlers.plan(FIXTURE, "cited-not-trained", { block: "both-extended" });
  check("... the person's word settles it (names compared without case)", same(p.blocked, ["TrainBot", "Both-Extended"]) && p.ask.length === 0);
  let e = null;
  try {
    crawlers.plan(FIXTURE, "cited-not-trained", { allow: "Ghost" });
  } catch (x) {
    e = x;
  }
  check("a robot the list does not know is refused, never written", e?.exit === crawlers.EXIT.USAGE);
  e = null;
  try {
    crawlers.plan(FIXTURE, "everything");
  } catch (x) {
    e = x;
  }
  check("an unknown strategy is refused", e?.exit === crawlers.EXIT.USAGE);
}

// ── 3. A robots.txt read as robots read it ──────────────────────────────────
console.log("\n── Un robots.txt lu comme les robots le lisent ──");
{
  const text = [
    "# commentaire",
    "User-agent: *",
    "Disallow: /api/",
    "",
    "user-agent: trainbot",
    "User-agent: old-bot",
    "Disallow: /",
    "",
    "User-agent: IndexBot",
    "Disallow: /",
    "Allow: /",
    "",
    "User-agent: Chat-User",
    "Disallow:",
    "",
    "Sitemap: https://example.fr/sitemap.xml",
  ].join("\n");
  const a = crawlers.audit(FIXTURE, text);
  const v = Object.fromEntries(a.crawlers.map((c) => [c.token, c]));
  check("a robot named in its own group follows it, its name read without case", v.TrainBot.group === "own" && v.TrainBot.allowed === false);
  check("Allow and Disallow of the same length: the least restrictive wins (RFC 9309)", v.IndexBot.group === "own" && v.IndexBot.allowed === true);
  check("an empty Disallow blocks nothing", v["Chat-User"].allowed === true);
  check("a robot not named follows the group for all robots", v["Both-Extended"].group === "all" && v["Both-Extended"].allowed === true);
  check("the retired names it still carries are said, with what replaced them", same(a.retired.map((r) => r.token), ["old-bot"]) && same(a.retired[0].replacedBy, ["TrainBot"]));
  check("its sitemaps are read", same(a.sitemaps, ["https://example.fr/sitemap.xml"]));
  const longest = crawlers.verdict(crawlers.parseRobots("User-agent: *\nDisallow: /\nAllow: /blog\n"), "Any", "/blog/post");
  check("the longest path decides", longest.allowed === true && crawlers.verdict(crawlers.parseRobots("User-agent: *\nDisallow: /\nAllow: /blog\n"), "Any", "/").allowed === false);
  check("no robots.txt at all: everything is allowed", crawlers.audit(FIXTURE, "").crawlers.every((c) => c.allowed && c.group === "none"));
}

// ── 4. The rules written into a project ─────────────────────────────────────
console.log("\n── Les règles écrites dans le projet ──");
const ROBOTS_TS = `import type { MetadataRoute } from "next";
import { siteUrl } from "~/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/api/og"], disallow: ["/api/"] }],
    sitemap: \`\${siteUrl()}/sitemap.xml\`,
  };
}
`;
{
  const dir = mkdtempSync(join(tmpdir(), "hv-geo-"));
  try {
    mkdirSync(join(dir, "src", "app"), { recursive: true });
    writeFileSync(join(dir, "src", "app", "robots.ts"), ROBOTS_TS);
    let e = null;
    try {
      crawlers.apply(FIXTURE, crawlers.plan(FIXTURE, "cited-not-trained"), { webDir: dir, today: "2026-10-14" });
    } catch (x) {
      e = x;
    }
    check("a robot still to decide: nothing written, the decision asked (exit 2)", e?.exit === crawlers.EXIT.ASK && !existsSync(join(dir, "src", "lib", "robots-ai.ts")));
    const p = crawlers.plan(FIXTURE, "cited-not-trained", { allow: "Both-Extended" });
    let r = crawlers.apply(FIXTURE, p, { webDir: dir, today: "2026-10-14" });
    const rules = readFileSync(join(dir, "src", "lib", "robots-ai.ts"), "utf8");
    const robots = readFileSync(join(dir, "src", "app", "robots.ts"), "utf8");
    check("robots.ts: the rules in src/lib/robots-ai.ts, only the robots to block, dated, with the strategy", r.wired === true && rules.includes('{ userAgent: ["TrainBot"], disallow: "/" }') && rules.includes("2026-10-14") && rules.includes("cited-not-trained") && !rules.includes("IndexBot"));
    check("... read by robots.ts, ahead of the group for all robots, imported once", robots.includes("rules: [...aiRobotRules, { userAgent: \"*\"") && robots.split('import { aiRobotRules } from "~/lib/robots-ai";').length === 2);
    r = crawlers.apply(FIXTURE, crawlers.plan(FIXTURE, "allow-all"), { webDir: dir, today: "2026-10-15" });
    const again = readFileSync(join(dir, "src", "app", "robots.ts"), "utf8");
    check("run again with another strategy: the rules replaced, robots.ts left as it was", r.already === true && again === robots && readFileSync(join(dir, "src", "lib", "robots-ai.ts"), "utf8").includes("= [];"));
    writeFileSync(join(dir, "src", "app", "robots.ts"), "export default function robots() { return { rules: [] }; }\n");
    rmSync(join(dir, "src", "lib"), { recursive: true, force: true });
    r = crawlers.apply(FIXTURE, crawlers.plan(FIXTURE, "block-all"), { webDir: dir, today: "2026-10-14" });
    check("a robots.ts of another shape: the rules written, the wiring said as left to do", r.wired === false && /aiRobotRules/.test(r.todo ?? ""));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const dir = mkdtempSync(join(tmpdir(), "hv-geo-"));
  try {
    mkdirSync(join(dir, "public"), { recursive: true });
    writeFileSync(join(dir, "public", "robots.txt"), "User-agent: *\r\nDisallow: /prive/\r\n\r\nUser-agent: TrainBot\r\nAllow: /\r\n");
    const p = crawlers.plan(FIXTURE, "block-all");
    let r = crawlers.apply(FIXTURE, p, { webDir: dir, today: "2026-10-14" });
    let text = readFileSync(join(dir, "public", "robots.txt"), "utf8");
    check("a static robots.txt: the block between its two markers, the file's own lines kept, its line endings too", text.includes("# BEGIN AI robots") && text.includes("# END AI robots") && text.includes("Disallow: /prive/") && text.includes("User-agent: Both-Extended\r\n") && !/[^\r]\n/.test(text));
    check("... a robot also named elsewhere in the file is said (the rules of every group naming it combine)", same(r.namedTwice, ["TrainBot"]));
    r = crawlers.apply(FIXTURE, crawlers.plan(FIXTURE, "allow-all"), { webDir: dir, today: "2026-10-15" });
    text = readFileSync(join(dir, "public", "robots.txt"), "utf8");
    check("run again: one block, replaced, never a second one", text.split("# BEGIN AI robots").length === 2 && !text.includes("User-agent: Both-Extended") && text.includes("No AI robot is blocked"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const dir = mkdtempSync(join(tmpdir(), "hv-geo-"));
  let e = null;
  try {
    crawlers.apply(FIXTURE, crawlers.plan(FIXTURE, "allow-all"), { webDir: dir });
  } catch (x) {
    e = x;
  }
  rmSync(dir, { recursive: true, force: true });
  check("no robots.txt in the project: refused, /seo named", e?.exit === crawlers.EXIT.ERROR && /\/seo/.test(e.message));
}

// ── 5. A page as AI robots receive it ───────────────────────────────────────
console.log("\n── Une page telle que les robots d'IA la reçoivent ──");
{
  const words = Array.from({ length: 80 }, (_, i) => `mot${i}`).join(" ");
  const ssr = `<!doctype html><html><head><title>Atelier</title><script>var x = "un script";</script></head><body><h1>L&#8217;atelier de céramique</h1><p>Nous donnons des cours d&rsquo;argile à Lyon. ${words}</p><script>self.__next_f.push([1,"payload"])</script></body></html>`;
  const csr = `<!doctype html><html><head><title>Atelier</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
  const challenge = `<!doctype html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></body></html>`;
  const server = createServer((req, res) => {
    const ua = String(req.headers["user-agent"] ?? "");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    if (req.url === "/ssr") return send(200, ssr);
    if (req.url === "/csr") return send(200, csr);
    if (req.url === "/mince") return send(200, "<!doctype html><html><body><h1>Atelier</h1><div id=\"root\"></div><script src=\"/app.js\"></script></body></html>");
    if (req.url === "/pare-feu") return /IndexBot/.test(ua) ? send(403, "<h1>Forbidden</h1>") : send(200, ssr);
    if (req.url === "/defi") return /Chat-User/.test(ua) ? send(503, challenge) : send(200, ssr);
    if (req.url === "/ferme") return send(403, "<h1>Forbidden</h1>");
    return send(404, "<h1>Not found</h1>");
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const robots = [
    { token: "IndexBot", operator: "A", userAgent: "Mozilla/5.0 (compatible; IndexBot/1.0)" },
    { token: "Chat-User", operator: "A", userAgent: "Mozilla/5.0 (compatible; Chat-User/1.0)" },
  ];
  try {
    let p = await fetchAsAi.checkPage(`${base}/ssr`, robots, ["L’atelier de céramique", "des cours d'argile à Lyon"]);
    check("a page drawn on the server: its text is in the HTML, found under every name (apostrophes and entities aside)", p.verdict === "ok" && p.textInHtml === true && p.robots.every((r) => r.expectFound === 2 && r.status === 200), JSON.stringify(p).slice(0, 300));
    check("... the scripts' text is not counted as the page's", !p.browser.h1?.includes("payload") && p.browser.words < 120);
    const raw = await fetchAsAi.fetchAs(`${base}/ssr`, "Mozilla/5.0 (compatible; IndexBot/1.0)");
    check("... nor the head's: neither a script's payload nor the title count as the page's text", !raw.text.includes("__next_f") && !raw.text.includes("un script") && raw.text.startsWith("L’atelier"));
    p = await fetchAsAi.checkPage(`${base}/mince`, robots);
    check("a page with its title and almost no text: empty for AI robots (the rest is drawn by JavaScript)", p.verdict === "empty-without-javascript" && Boolean(p.browser.h1));
    p = await fetchAsAi.checkPage(`${base}/csr`, robots);
    check("a page drawn by JavaScript: empty for AI robots, said", p.verdict === "empty-without-javascript" && p.textInHtml === false);
    p = await fetchAsAi.checkPage(`${base}/ssr`, robots, ["une phrase absente de la page"]);
    check("a sentence of the source missing from the HTML: the text is not there", p.textInHtml === false && p.verdict === "empty-without-javascript");
    p = await fetchAsAi.checkPage(`${base}/pare-feu`, robots);
    check("a firewall that refuses one robot by its name: blocked for that robot only, the page itself fine", p.verdict === "blocked-for-ai" && same(p.blockedFor, ["IndexBot"]));
    p = await fetchAsAi.checkPage(`${base}/defi`, robots);
    check("a challenge page served to a robot: it is turned away", p.verdict === "blocked-for-ai" && same(p.blockedFor, ["Chat-User"]) && p.robots.find((r) => r.token === "Chat-User").challenge === true);
    p = await fetchAsAi.checkPage(`${base}/ferme`, robots);
    check("a page closed to everyone: unreachable, never \"blocked for AI\"", p.verdict === "unreachable" && p.blockedFor.length === 0);
  } finally {
    server.close();
  }
  const tried = fetchAsAi.robotsToTry();
  const citing = data.crawlers.filter((c) => c.role === "search-index" || c.role === "user-fetch");
  check("the robots borrowed for the test are all the list's indexers and fetchers: their published full name, else their bare name, said synthetic", tried.length === citing.length && tried.every((r) => r.userAgent.toLowerCase().includes(r.token.toLowerCase()) && r.synthetic === !citing.find((c) => c.token === r.token).userAgent));
}

// ── 6. The skill names no robot ─────────────────────────────────────────────
console.log("\n── La skill ne nomme aucun robot ──");
{
  const files = ["SKILL.md", "DOC.md", "DOC.fr.md"].map((f) => join(ROOT, "skills", "geo", f)).filter(existsSync);
  const names = [...data.crawlers.map((c) => c.token), ...(data.retired ?? []).map((r) => r.token)];
  const found = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const n of names) if (new RegExp(`(^|[^A-Za-z0-9-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9-]|$)`).test(text)) found.push(`${f.split(/[\\/]/).slice(-2).join("/")}: ${n}`);
    if (/^\s*User-agent:/im.test(text)) found.push(`${f.split(/[\\/]/).slice(-2).join("/")}: a User-agent line`);
  }
  check("no robot's name nor robots.txt line written in the skill or its pages: the list is read in its file", found.length === 0, found.join(" | "));
  const skill = readFileSync(join(ROOT, "skills", "geo", "SKILL.md"), "utf8");
  // Each verb has its moment: list to read, plan to show, apply to write, audit to check what robots read online.
  const missing = ["list", "plan --strategy", "apply --strategy", "audit --url"].filter((verb) => !skill.includes(`scripts/geo/crawlers.mjs" ${verb}`));
  check("the skill reads the list, tests the pages as robots, builds the rules from the list and checks the ones robots read online (list, plan, apply, audit --url)", skill.includes("scripts/geo/fetch-as-ai.mjs") && missing.length === 0, `missing: ${missing.join(", ")}`);
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
