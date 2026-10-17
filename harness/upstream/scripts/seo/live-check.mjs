#!/usr/bin/env node
// live-check.mjs - What only shows on the deployed site, read from it (3.4.12), for /seo: reading the
// code says what Google could see, this says what it sees. Checked:
//   - a noindex left by mistake (the robots meta tag, or the X-Robots-Tag header);
//   - a canonical address or an og:url that names localhost, or the *.vercel.app address while
//     the site has its own domain;
//   - the production *.vercel.app address doubling the site (neither moved to the domain, nor
//     canonical to it, nor kept out of the index);
//   - a page that does not exist answering 200 instead of 404 (a "soft 404");
//   - a temporary redirect (302, 307) where a permanent one is meant: http to https, www and the
//     bare domain, *.vercel.app to the domain (Google takes 301 and 308 as permanent alike);
//   - internal links that lead nowhere;
//   - a sitemap that lists pages that redirect, are missing, are kept out of the index, or name
//     another page as their canonical;
//   - a robots.txt that closes the whole site, or names no sitemap.
//
//   node live-check.mjs --url https://example.fr [--vercel <project>.vercel.app] [--max-pages 30]
//
// Reads only, with a plain HTTP client (no browser, no JavaScript): at most --max-pages pages of the
// sitemap (30 by default) and 100 internal links. Exit codes: 0 read (findings or not), 1 the site
// could not be reached, 5 usage. One JSON object on stdout: {ok, site, findings: [{check, severity,
// url, detail}], counts}.

import { randomBytes } from "node:crypto";

export const EXIT = { OK: 0, UNREACHABLE: 1, USAGE: 5 };
const UA = "Mozilla/5.0 (compatible; hypervibe-seo-check/1.0; +https://hypervibe.fr)";
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

async function getWith(fetchImpl, url, { manual = false, method = "GET" } = {}) {
  try {
    const res = await fetchImpl(url, { method, redirect: manual ? "manual" : "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml" }, signal: AbortSignal.timeout(20000) });
    const body = method === "HEAD" || manual ? "" : await res.text().catch(() => "");
    return { status: res.status, url: res.url || url, headers: res.headers, body };
  } catch (e) {
    return { status: null, url, error: e.message, headers: new Headers(), body: "" };
  }
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? "") : null;
};
/** The head's signals: robots meta, canonical, og:url. */
export function headSignals(html) {
  const tags = String(html ?? "").match(/<(meta|link)\b[^>]*>/gi) ?? [];
  let robots = "";
  let canonical = null;
  let ogUrl = null;
  for (const t of tags) {
    const name = (attr(t, "name") ?? "").toLowerCase();
    const prop = (attr(t, "property") ?? "").toLowerCase();
    const rel = (attr(t, "rel") ?? "").toLowerCase();
    if (/^meta/i.test(t.slice(1)) && (name === "robots" || name === "googlebot")) robots += ` ${(attr(t, "content") ?? "").toLowerCase()}`;
    if (/^meta/i.test(t.slice(1)) && prop === "og:url") ogUrl = attr(t, "content");
    if (/^link/i.test(t.slice(1)) && rel.split(/\s+/).includes("canonical")) canonical = attr(t, "href");
  }
  return { noindexMeta: /\bnoindex\b|\bnone\b/.test(robots), canonical, ogUrl };
}
const noindexHeader = (headers) => /\bnoindex\b|\bnone\b/i.test(headers.get("x-robots-tag") ?? "");

/** The internal links of a page: same host, no fragment, no file to download. */
export function internalLinks(html, pageUrl) {
  const out = new Set();
  const base = new URL(pageUrl);
  for (const m of String(html ?? "").matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const href = (m[2] ?? m[3] ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript|data):/i.test(href)) continue;
    let u;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
    u.hash = "";
    out.add(u.toString());
  }
  return [...out];
}

/** The <loc> addresses of a sitemap (one level of sitemap index followed). */
async function sitemapUrls(get, site, max) {
  const first = await get(`${site}/sitemap.xml`);
  if (first.status !== 200) return { status: first.status, urls: [] };
  const locs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  let urls = locs(first.body);
  if (/<sitemapindex\b/i.test(first.body)) {
    const nested = [];
    for (const s of urls.slice(0, 5)) nested.push(...locs((await get(s)).body));
    urls = nested;
  }
  return { status: 200, urls: urls.slice(0, max), total: urls.length };
}

export async function check({ url, vercel = null, maxPages = 30, fetchImpl = fetch }) {
  const get = (u, o = {}) => getWith(fetchImpl, u, o);
  const site = String(url).replace(/\/+$/, "");
  const host = new URL(site).host;
  const findings = [];
  const add = (check, severity, at, detail) => findings.push({ check, severity, url: at, detail });

  const home = await get(`${site}/`);
  if (home.status === null || home.status >= 500) return { reachable: false, error: home.error ?? `HTTP ${home.status}` };

  // robots.txt
  const robots = await get(`${site}/robots.txt`);
  if (robots.status === 200) {
    const groups = robots.body.split(/\n\s*\n/);
    const all = groups.find((g) => /^\s*user-agent\s*:\s*\*\s*$/im.test(g));
    if (all && /^\s*disallow\s*:\s*\/\s*$/im.test(all) && !/^\s*allow\s*:\s*\/\s*$/im.test(all)) add("robots-closed", "high", `${site}/robots.txt`, "robots.txt closes the whole site to every robot (Disallow: / for all).");
    if (!/^\s*sitemap\s*:/im.test(robots.body)) add("robots-no-sitemap", "low", `${site}/robots.txt`, "robots.txt names no sitemap.");
  } else if (robots.status === 404) add("robots-missing", "low", `${site}/robots.txt`, "No robots.txt (robots then read everything: harmless, but the sitemap goes unnamed).");

  // Pages: the home, then the sitemap's.
  const sm = await sitemapUrls(get, site, maxPages);
  if (sm.status !== 200) add("sitemap-missing", "medium", `${site}/sitemap.xml`, `The sitemap answers HTTP ${sm.status ?? "nothing"}.`);
  const pages = [...new Set([`${site}/`, ...sm.urls])];
  const links = new Set();
  for (const p of pages) {
    const first = await get(p, { manual: true });
    const inSitemap = sm.urls.includes(p);
    if (first.status >= 300 && first.status < 400) {
      if (inSitemap) add("sitemap-redirect", "medium", p, `The sitemap lists an address that redirects (HTTP ${first.status} to ${first.headers.get("location")}): list the final address.`);
      continue;
    }
    const page = p === `${site}/` ? home : await get(p);
    if (page.status !== 200) {
      if (inSitemap) add("sitemap-error", "high", p, `The sitemap lists a page that answers HTTP ${page.status ?? "nothing"}.`);
      continue;
    }
    const s = headSignals(page.body);
    if (s.noindexMeta || noindexHeader(page.headers)) add(inSitemap ? "sitemap-noindex" : "noindex", "high", p, `The page is kept out of the index (${s.noindexMeta ? "robots meta tag" : "X-Robots-Tag header"})${inSitemap ? " yet listed in the sitemap" : ""}.`);
    for (const [label, value] of [["canonical", s.canonical], ["og:url", s.ogUrl]]) {
      if (!value) continue;
      if (LOCAL.test(value)) add("local-address", "high", p, `Its ${label} names this machine: ${value}.`);
      else if (/\.vercel\.app/i.test(value) && !/\.vercel\.app$/i.test(host)) add("vercel-address", "high", p, `Its ${label} names the *.vercel.app address instead of the domain: ${value}.`);
    }
    if (inSitemap && s.canonical) {
      let canon = null;
      try {
        canon = new URL(s.canonical, p).toString().replace(/\/$/, "");
      } catch {}
      if (canon && canon !== p.replace(/\/$/, "")) add("sitemap-not-canonical", "medium", p, `The sitemap lists a page whose canonical is another: ${s.canonical}.`);
    }
    for (const l of internalLinks(page.body, page.url)) links.add(l);
  }

  // Internal links that lead nowhere (100 at most); a linked page kept out of the index by its
  // header is said too, lower: it may be meant (a legal page, an account page).
  for (const l of [...links].filter((l) => !pages.includes(l)).slice(0, 100)) {
    let r = await get(l, { method: "HEAD" });
    if (r.status === 405 || r.status === 501) r = await get(l);
    if (r.status === null || r.status >= 400) add("broken-link", "medium", l, `An internal link leads to HTTP ${r.status ?? "nothing"}.`);
    else if (noindexHeader(r.headers)) add("noindex-linked", "low", l, "A page the site links to is kept out of the index (X-Robots-Tag header): is it meant?");
  }

  // A page that does not exist must answer 404.
  const ghost = `${site}/hv-${randomBytes(6).toString("hex")}`;
  // Next.js keeps a 200 once streaming has started, but then marks the page noindex: Google will not
  // index it, so only a 200 without noindex is reported.
  const g = await get(ghost);
  if (g.status === 200 && !headSignals(g.body).noindexMeta && !noindexHeader(g.headers)) add("soft-404", "high", ghost, "A page that does not exist answers 200 instead of 404, and is not kept out of the index: Google may index empty pages.");

  // Permanent moves: http to https, www and the bare domain, *.vercel.app to the domain.
  const temporary = (r) => r.status === 302 || r.status === 307 || r.status === 303;
  const httpHome = await get(`http://${host}/`, { manual: true });
  if (temporary(httpHome)) add("temporary-redirect", "medium", `http://${host}/`, `http to https is a temporary redirect (HTTP ${httpHome.status}): 301 or 308 tell Google the move is for good.`);
  const other = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  const otherHome = await get(`https://${other}/`, { manual: true });
  if (otherHome.status !== null) {
    if (temporary(otherHome)) add("temporary-redirect", "medium", `https://${other}/`, `${other} moves to ${host} with a temporary redirect (HTTP ${otherHome.status}): 301 or 308 tell Google the move is for good.`);
    else if (otherHome.status === 200) add("duplicate-host", "medium", `https://${other}/`, `${other} answers the site itself instead of moving to ${host}: two addresses for the same pages.`);
  }
  if (vercel) {
    const v = await get(`https://${vercel}/`, { manual: true });
    if (temporary(v)) add("temporary-redirect", "medium", `https://${vercel}/`, `The *.vercel.app address moves to the domain with a temporary redirect (HTTP ${v.status}).`);
    else if (v.status === 200) {
      const full = await get(`https://${vercel}/`);
      const s = headSignals(full.body);
      const canonToDomain = s.canonical && new URL(s.canonical, `https://${vercel}/`).host === host;
      if (!canonToDomain && !s.noindexMeta && !noindexHeader(full.headers)) add("vercel-duplicate", "high", `https://${vercel}/`, `The *.vercel.app address shows the site too, without moving to ${host}, naming it as canonical, or being kept out of the index: Google can index it as a copy.`);
    }
  }

  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return { reachable: true, site, pagesRead: pages.length, sitemapTotal: sm.total ?? 0, linksChecked: Math.min(100, [...links].filter((l) => !pages.includes(l)).length), findings, counts };
}

async function main(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) return { code: EXIT.USAGE, out: { ok: false, error: "Usage: live-check.mjs --url https://example.fr [--vercel <project>.vercel.app] [--max-pages 30]" } };
    f[argv[i].slice(2)] = argv[i + 1];
  }
  if (!/^https?:\/\/[^\s/]+\/?$/.test(f.url ?? "")) return { code: EXIT.USAGE, out: { ok: false, error: "Give the site's address alone: --url https://example.fr" } };
  const r = await check({ url: f.url, vercel: f.vercel ?? null, maxPages: Number(f["max-pages"] ?? 30) || 30 });
  if (!r.reachable) return { code: EXIT.UNREACHABLE, out: { ok: false, site: f.url, error: `The site could not be read (${r.error}).` } };
  return { code: EXIT.OK, out: { ok: true, ...r } };
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
