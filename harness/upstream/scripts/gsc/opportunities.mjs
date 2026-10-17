#!/usr/bin/env node
// opportunities.mjs - What Search Console says of a site's queries over the last 28 days, read
// once for /gsc and /seo (3.4.12): the queries just outside the first page (positions 11 to 20:
// little work, much gain), the queries seen a lot on the first page but rarely clicked (a title or
// a description to rewrite), and each page's figures. /seo uses the impressions instead of a
// "search volume" no free source gives, and rewrites the titles of these pages first.
//
//   node opportunities.mjs --domain <domain> [--days 28]
//
// Read-only (a --readonly token, forged by gsc-token.mjs from the vault; never printed). The
// property is looked for as Search Console names it: the domain (sc-domain:) first, then the
// site's https:// address with and without www.
//
// The thresholds are a rule of thumb, said in the output: positions 11 to 20 (rounded) with at
// least 10 impressions; on the first page, at least 50 impressions and under 2 % clicked.
//
// Exit codes: 0 read, 1 an error, 2 the vault is locked, 3 its session expired, 4 Search Console
// is not set up (no service account in the vault: /gsc sets it up), 6 the site is not a property
// the service account can read (/gsc connects it). One JSON object on stdout.
//
// Recettes only: HYPERVIBE_GSC_API, a fake on the loopback (anything else is ignored); with it,
// and only then, the token may come from GSC_TOKEN.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOOGLE = "https://www.googleapis.com/webmasters/v3";
export const EXIT = { OK: 0, ERROR: 1, LOCKED: 2, EXPIRED: 3, NOT_SET_UP: 4, NO_PROPERTY: 6 };
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const RULES = Object.freeze({ nearTop: { from: 11, to: 20, minImpressions: 10 }, lowCtr: { maxPosition: 10, minImpressions: 50, maxCtr: 0.02 } });

export function apiBase(env = process.env) {
  const o = env.HYPERVIBE_GSC_API;
  return o && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o) ? `${o}/webmasters/v3` : GOOGLE;
}

function forgeFromVault() {
  return spawnSync(process.execPath, [join(HERE, "gsc-token.mjs"), "--readonly"], { encoding: "utf8", windowsHide: true });
}

/** The token: from the environment only with a recette's loopback API, else forged from the vault. */
export function token(env, base, forge = forgeFromVault) {
  if (base !== GOOGLE) return env.GSC_TOKEN ? { token: env.GSC_TOKEN } : { code: EXIT.NOT_SET_UP, error: "No Search Console token." };
  const r = forge();
  const value = String(r.stdout ?? "").trim();
  if (r.status === 0 && value) return { token: value };
  if (r.status === 2) return { code: EXIT.LOCKED, error: "The vault is locked: open it, then retry." };
  if (r.status === 3) return { code: EXIT.EXPIRED, error: "The vault's session expired: open it again, then retry." };
  if (r.status === 4) return { code: EXIT.NOT_SET_UP, error: "Search Console is not set up on this machine (/gsc sets it up)." };
  return { code: EXIT.ERROR, error: "A Search Console token could not be forged." };
}

async function call(base, tok, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const day = (d) => d.toISOString().slice(0, 10);

/** The queries read into the three lists. `rows`: Search Console's, by query and page. */
export function analyse(rows) {
  const items = rows.map((r) => ({ query: r.keys?.[0] ?? "", page: r.keys?.[1] ?? "", clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0 }));
  const byImpressions = (a, b) => b.impressions - a.impressions;
  const near = RULES.nearTop;
  const low = RULES.lowCtr;
  const pages = new Map();
  for (const i of items) {
    const p = pages.get(i.page) ?? { page: i.page, clicks: 0, impressions: 0, queries: 0, weighted: 0 };
    p.clicks += i.clicks;
    p.impressions += i.impressions;
    p.queries += 1;
    p.weighted += i.position * i.impressions;
    pages.set(i.page, p);
  }
  return {
    queries: [...items].sort(byImpressions).slice(0, 50),
    nearTop: items.filter((i) => Math.round(i.position) >= near.from && Math.round(i.position) <= near.to && i.impressions >= near.minImpressions).sort(byImpressions).slice(0, 20),
    lowCtr: items.filter((i) => i.position <= low.maxPosition && i.impressions >= low.minImpressions && i.ctr < low.maxCtr).sort(byImpressions).slice(0, 20),
    pages: [...pages.values()]
      .map(({ weighted, ...p }) => ({ ...p, ctr: p.impressions ? p.clicks / p.impressions : 0, position: p.impressions ? weighted / p.impressions : null }))
      .sort(byImpressions)
      .slice(0, 50),
  };
}

export async function main(argv, env = process.env, now = new Date()) {
  const i = argv.indexOf("--domain");
  const domain = i >= 0 ? String(argv[i + 1] ?? "").toLowerCase() : "";
  const d = argv.indexOf("--days");
  const days = d >= 0 ? Number(argv[d + 1]) : 28;
  if (!DOMAIN.test(domain) || !Number.isInteger(days) || days < 7 || days > 480) {
    return { code: EXIT.ERROR, out: { ok: false, error: "Usage: opportunities.mjs --domain <domain> [--days 28] (the domain alone: monsite.fr)." } };
  }
  const base = apiBase(env);
  const t = token(env, base);
  if (!t.token) return { code: t.code, out: { ok: false, connected: false, error: t.error } };
  try {
    const sites = await call(base, t.token, "/sites");
    if (sites.status !== 200) return { code: EXIT.ERROR, out: { ok: false, error: `Search Console's properties could not be read (HTTP ${sites.status}).` } };
    const owned = new Set((sites.json?.siteEntry ?? []).map((s) => s.siteUrl));
    const property = [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`].find((p) => owned.has(p));
    if (!property) return { code: EXIT.NO_PROPERTY, out: { ok: false, connected: false, domain, error: `${domain} is not a Search Console property this machine can read (/gsc connects it).` } };
    // Search Console's figures arrive two or three days late: the period ends three days ago.
    const end = new Date(now.getTime() - 3 * 86400000);
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const q = await call(base, t.token, `/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { startDate: day(start), endDate: day(end), dimensions: ["query", "page"], rowLimit: 1000 });
    if (q.status !== 200) return { code: EXIT.ERROR, out: { ok: false, property, error: `Search Console's figures could not be read (HTTP ${q.status}).` } };
    const rows = q.json?.rows ?? [];
    // The totals come from a query without dimensions: the rows by query leave out the queries
    // Search Console keeps anonymous, and would undercount.
    const all = await call(base, t.token, `/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { startDate: day(start), endDate: day(end) });
    const tot = all.status === 200 ? all.json?.rows?.[0] : null;
    const totals = tot ? { clicks: tot.clicks ?? 0, impressions: tot.impressions ?? 0, ctr: tot.ctr ?? 0, position: tot.position ?? null } : null;
    return { code: EXIT.OK, out: { ok: true, connected: true, property, period: { start: day(start), end: day(end) }, totals, rows: rows.length, rules: RULES, ...analyse(rows) } };
  } catch (e) {
    return { code: EXIT.ERROR, out: { ok: false, error: `Search Console could not be reached (${e.message}).` } };
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
