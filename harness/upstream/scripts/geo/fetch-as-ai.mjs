#!/usr/bin/env node
// fetch-as-ai.mjs - A page as AI robots receive it (3.4.12). Almost none of them runs JavaScript:
// a page whose text is drawn in the browser is empty for them, however good it looks. This script
// fetches each page the way they do (its HTML only, under their names, read in ai-crawlers.json),
// and says whether the page's main text is in that HTML, and whether something turns them away.
//
//   node fetch-as-ai.mjs --url <page> [--url <page> ...] [--expect "<sentence>" ...]
//
// --expect: a few sentences of the page's main text, taken from its source (several are allowed),
// looked for in the HTML; without them, the page's H1 and the amount of visible text decide.
//
// A firewall that recognises robots by their network addresses (as Cloudflare does for the robots
// it verifies) can answer this machine differently from the real robot: a refusal here is a sign,
// an acceptance is not a proof. The firewall's own setting is read elsewhere (/geo).
//
// Exit codes: 0 every page read, 1 a page could not be read at all, 5 usage.
// One JSON object on stdout.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXIT = { OK: 0, UNREADABLE: 1, USAGE: 5 };
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
/** What a challenge page or a firewall's refusal carries in its HTML. */
const CHALLENGE = ["/cdn-cgi/challenge-platform/", "cf-chl-", "Just a moment...", "Attention Required! | Cloudflare", "Vercel Security Checkpoint"];
const MIN_WORDS = 50;

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç" };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/** The text a reader without JavaScript sees: no scripts, styles, templates nor head. */
export function visibleText(html) {
  return decode(
    String(html ?? "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const firstTag = (html, tag) => {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(String(html ?? ""));
  return m ? visibleText(m[1]) || null : null;
};
/** For comparing a sentence of the source with the HTML: case, spaces and apostrophes aside. */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").trim();

/** One page under one name: {status, words, h1, challenge, text}. */
export async function fetchAs(url, userAgent, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { status: null, error: e.message };
  }
  const html = await res.text().catch(() => "");
  const text = visibleText(html);
  return {
    status: res.status,
    finalUrl: res.url || url,
    words: text ? text.split(" ").length : 0,
    h1: firstTag(html, "h1"),
    title: firstTag(html, "title"),
    challenge: CHALLENGE.some((m) => html.includes(m)),
    text,
  };
}

const refused = (r) => r.status === null || r.status >= 400 || r.challenge;

/** A page under the browser's name and each AI robot's: what they receive, and the verdict. */
export async function checkPage(url, robots, expect = [], fetchImpl = fetch) {
  const browser = await fetchAs(url, BROWSER, fetchImpl);
  const looked = expect.map((t) => ({ text: t, found: norm(browser.text).includes(norm(t)) }));
  const results = [];
  for (const r of robots) {
    const got = await fetchAs(url, r.userAgent, fetchImpl);
    const t = norm(got.text);
    results.push({
      token: r.token,
      operator: r.operator,
      status: got.status,
      words: got.words ?? 0,
      challenge: got.challenge ?? false,
      ...(got.error ? { error: got.error } : {}),
      ...(expect.length ? { expectFound: expect.filter((e) => t.includes(norm(e))).length } : {}),
    });
  }
  const { text, ...seen } = browser;
  const textInHtml = !refused(browser) && (expect.length ? looked.every((l) => l.found) : Boolean(browser.h1) && browser.words >= MIN_WORDS);
  const blockedFor = refused(browser) ? [] : results.filter(refused).map((r) => r.token);
  const verdict = refused(browser) ? "unreachable" : blockedFor.length ? "blocked-for-ai" : textInHtml ? "ok" : "empty-without-javascript";
  return { url, browser: seen, ...(expect.length ? { expect: looked } : {}), textInHtml, blockedFor, robots: results, verdict };
}

/** The robots to impersonate: those that fill an AI engine's index or fetch for someone chatting.
 *  Under the full name their operator publishes; an operator that publishes none (Anthropic, today)
 *  gets the bare name, said "synthetic": a firewall that reads names still recognises it. */
export function robotsToTry(file = join(HERE, "ai-crawlers.json")) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  return data.crawlers
    .filter((c) => c.role === "search-index" || c.role === "user-fetch")
    .map((c) => ({ token: c.token, operator: c.operator, userAgent: c.userAgent ?? `Mozilla/5.0 (compatible; ${c.token})`, synthetic: !c.userAgent }));
}

async function main(argv) {
  const urls = [];
  const expect = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--url" && argv[i + 1]) urls.push(argv[++i]);
    else if (argv[i] === "--expect" && argv[i + 1]) expect.push(argv[++i]);
    else return { code: EXIT.USAGE, out: { ok: false, error: `Unknown argument ${argv[i]}. Usage: fetch-as-ai.mjs --url <page> [--url ...] [--expect "<sentence>" ...]` } };
  }
  if (!urls.length || urls.some((u) => !/^https?:\/\/[^\s/]+/.test(u))) return { code: EXIT.USAGE, out: { ok: false, error: "Give the pages as full addresses: --url https://example.com/page." } };
  const robots = robotsToTry();
  const pages = [];
  for (const u of urls) pages.push(await checkPage(u, robots, expect));
  const unreadable = pages.filter((p) => p.verdict === "unreachable").length;
  return {
    code: unreadable ? EXIT.UNREADABLE : EXIT.OK,
    out: { ok: !unreadable, robots: robots.map((r) => r.token), pages, note: "A refusal under a robot's name is a sign; an acceptance is not a proof: a firewall can recognise the real robots by their network addresses." },
  };
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
