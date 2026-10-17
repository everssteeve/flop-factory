#!/usr/bin/env node
// cloudflare-ai.mjs - Whether Cloudflare turns AI robots away from a site, read for /geo (3.4.12).
// Read only: nothing is ever changed here.
//
// What Cloudflare says (its documentation and blog, read on 14/10/2026): since July 2025 a new domain
// is asked at sign-up whether to let AI crawlers in; since 15 September 2026 the setting is
// "Configure AI bot policies", one policy per family of robots (Search, Agent, Training), each
// "Allow (do not block)", "Block on pages with ads" or "Block (on all pages)", Training also
// "Disallow AI Training" (a robots.txt rule, kept in step by Bot Preference Sync). A "Block" now
// also stops Google's, Bing's and Apple's search robots: the site leaves those search engines too.
// The older "Block AI bots" switch is being retired. All of it acts only on the traffic Cloudflare
// carries: a record that is "DNS only" (not proxied, the usual case for a site hosted on Vercel)
// sends visitors straight to the host, and none of these settings touches it.
//
//   node cloudflare-ai.mjs --domain <domain>
//
// One JSON object on stdout, never a key: {ok, domain, zone, proxied: {<name>: true|false},
// carried, readable, policies: {search, agent, training, legacy, preferenceSync, managedRobotsTxt},
// findings: [...], procedure}. Reading the policies needs the token's right "Zone · Bot Management ·
// Read"; without it, `readable` is false and `procedure` says where to look in the dashboard.
//
// Exit codes: 0 read (the policies may be unreadable: said), 1 a read failed or Cloudflare refused
// (its words in `error`), 3 the vault is locked or its session expired, 4 no Cloudflare key in the
// vault, 5 usage.
//
// Recettes only: HYPERVIBE_CLOUDFLARE_API, a fake on the loopback (anything else is ignored); with
// it, and only then, the key may come from CLOUDFLARE_API_TOKEN.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLOUDFLARE = "https://api.cloudflare.com/client/v4";
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const EXIT = { OK: 0, UNREADABLE: 1, LOCKED: 3, NO_KEY: 4, USAGE: 5 };
export const PROCEDURE =
  "In the Cloudflare dashboard, open the domain, then Security > Settings, filter on Bot traffic, and select Configure AI bot policies: Search, Agent and Training each show their policy (Allow, Block on pages with ads, Block; Training also Disallow AI Training). AI Crawl Control lists the robots one by one. Reading it from here needs the token's right Zone · Bot Management · Read.";

export function apiBase(env = process.env) {
  const o = env.HYPERVIBE_CLOUDFLARE_API;
  return o && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o) ? `${o}/client/v4` : CLOUDFLARE;
}
/** The key: from the environment only with a recette's loopback API, from the vault otherwise. */
export function readKey(env = process.env, base = apiBase(env), vault = fromVault) {
  if (base !== CLOUDFLARE) return env.CLOUDFLARE_API_TOKEN ? { key: env.CLOUDFLARE_API_TOKEN } : { code: EXIT.NO_KEY, error: "No Cloudflare key." };
  const r = vault();
  if (r.status === 2 || r.status === 3) return { code: EXIT.LOCKED, error: "The vault is locked (or its session expired): open it, then retry." };
  const key = String(r.value ?? "").trim();
  return r.status === 0 && key ? { key } : { code: EXIT.NO_KEY, error: "The Cloudflare key is not in the vault (item CLOUDFLARE, field api_token): /start sets it up." };
}
function fromVault() {
  const r = spawnSync(process.execPath, [join(HERE, "..", "vault", "vault.mjs"), "get", "CLOUDFLARE", "api_token"], { encoding: "utf8", windowsHide: true });
  return { status: r.status, value: String(r.stdout ?? "").trim() };
}

async function cf(base, key, path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, ok: res.status === 200 && json?.success === true };
}
const said = (r) => r.json?.errors?.[0]?.message ?? `HTTP ${r.status}`;
const refused = (r) => r.status === 401 || r.status === 403 || (r.json?.errors ?? []).some((e) => e.code === 10000 || e.code === 9109);

/** What the zone's policies mean for a site that wants to be cited: a list of findings. */
export function meaning(p) {
  const out = [];
  const blocks = (v) => v === "block" || v === "only_on_ad_pages";
  if (blocks(p.search)) out.push({ family: "search", severity: "high", what: `AI search robots are blocked (${p.search})${p.search === "block" ? "; since 15 September 2026 a Block also stops Google's, Bing's and Apple's search robots: the site leaves those search engines too" : " on pages with ads"}.` });
  if (blocks(p.agent)) out.push({ family: "agent", severity: "medium", what: `Robots fetching for someone (agents, chats) are blocked (${p.agent}).` });
  if (blocks(p.training)) out.push({ family: "training", severity: "low", what: `Training robots are blocked at the firewall (${p.training}): consistent with "cited, not trained", finer through robots.txt ("Disallow AI Training").` });
  if (p.legacy === "block" || p.legacy === "only_on_ad_pages") out.push({ family: "legacy", severity: "high", what: `The older "Block AI bots" switch is on (${p.legacy}): it turns away AI robots, those that cite included.` });
  if (p.managedRobotsTxt || p.preferenceSync) out.push({ family: "robots.txt", severity: "info", what: "Cloudflare adds its own rules to the robots.txt it serves (Bot Preference Sync, formerly managed robots.txt): read the live robots.txt, not only the project's." });
  return out;
}

export async function main(argv, env = process.env) {
  const i = argv.indexOf("--domain");
  const domain = i >= 0 ? String(argv[i + 1] ?? "").toLowerCase() : "";
  if (!DOMAIN.test(domain) || argv.length !== 2) return { code: EXIT.USAGE, out: { ok: false, error: "Usage: cloudflare-ai.mjs --domain <domain> (lower case, without https://)." } };
  const base = apiBase(env);
  const k = readKey(env, base);
  if (!k.key) return { code: k.code, out: { ok: false, error: k.error } };
  try {
    // The zone: the domain's own, or the one a subdomain falls under (one label up at a time).
    const labels = domain.split(".");
    let zone = null;
    for (let n = 0; n < labels.length - 1 && !zone; n += 1) {
      const name = labels.slice(n).join(".");
      const z = await cf(base, k.key, `/zones?name=${encodeURIComponent(name)}`);
      if (!z.ok) return { code: EXIT.UNREADABLE, out: { ok: false, domain, error: `The zone could not be read at Cloudflare: ${said(z)}` } };
      const list = z.json.result ?? [];
      if (list.length > 1) return { code: EXIT.UNREADABLE, out: { ok: false, domain, error: `Several Cloudflare zones are named ${name}: say which one.` } };
      if (list.length === 1) zone = { id: list[0].id, name: list[0].name };
    }
    if (!zone) return { code: EXIT.UNREADABLE, out: { ok: false, domain, error: `No Cloudflare zone serves ${domain}: its DNS is elsewhere, and Cloudflare's settings do not touch it.` } };
    // The site's records: proxied or not (the policies act only on the traffic Cloudflare carries).
    const proxied = {};
    for (const name of [domain, `www.${domain}`]) {
      const r = await cf(base, k.key, `/zones/${zone.id}/dns_records?name=${encodeURIComponent(name)}&per_page=100`);
      if (!r.ok) return { code: EXIT.UNREADABLE, out: { ok: false, domain, zone: zone.name, error: `The zone's records could not be read: ${said(r)}` } };
      const web = (r.json.result ?? []).filter((x) => ["A", "AAAA", "CNAME"].includes(x.type));
      if (web.length) proxied[name] = web.some((x) => x.proxied === true);
    }
    const carried = Object.values(proxied).some(Boolean);
    const bm = await cf(base, k.key, `/zones/${zone.id}/bot_management`);
    if (!bm.ok && !refused(bm)) return { code: EXIT.UNREADABLE, out: { ok: false, domain, zone: zone.name, proxied, carried, error: `The zone's bot settings could not be read: ${said(bm)}` } };
    const base1 = { ok: true, domain, zone: zone.name, proxied, carried, appliesToSite: carried };
    if (!bm.ok) return { code: EXIT.OK, out: { ...base1, readable: false, policies: null, findings: [], procedure: PROCEDURE } };
    const r = bm.json.result ?? {};
    const policies = {
      search: r.ai_search ?? null,
      agent: r.ai_user ?? null,
      training: r.ai_training ?? null,
      legacy: r.ai_bots_protection ?? null,
      preferenceSync: r.bot_preference_sync_enabled ?? null,
      managedRobotsTxt: r.is_robots_txt_managed ?? null,
    };
    return { code: EXIT.OK, out: { ...base1, readable: true, policies, findings: meaning(policies), procedure: PROCEDURE } };
  } catch (e) {
    return { code: EXIT.UNREADABLE, out: { ok: false, domain, error: `Cloudflare could not be reached: ${e.message}` } };
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
