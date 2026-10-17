#!/usr/bin/env node
// test-seo-tools.mjs - Two tools of /seo and /geo (3.4.12): the checks that only show on the
// deployed site (live-check.mjs, against a fake site served by an injected client: a noindex left
// by mistake, localhost or *.vercel.app in a canonical, a soft 404, temporary redirects, broken
// links, a sitemap that lists what it should not), and the scores computed on a fixed grid and
// kept in the project (report.mjs). No network.
//
//   node scripts/tests/test-seo-tools.mjs

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const live = await import(pathToFileURL(join(ROOT, "scripts", "seo", "live-check.mjs")).href);
const report = await import(pathToFileURL(join(ROOT, "scripts", "seo", "report.mjs")).href);

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 500)})`}`);
}

/** A fake site: routes by full address; `redirect` answers 3xx, followed unless asked not to. */
function fakeSite(routes, fallback) {
  return async (url, opts = {}) => {
    let u = String(url);
    for (let hops = 0; hops < 5; hops += 1) {
      const r = routes[u] ?? fallback(u);
      if (r === null) throw new TypeError("fetch failed");
      if (r.redirect) {
        if (opts.redirect === "manual") return new Response(null, { status: r.status, headers: { location: r.redirect } });
        u = r.redirect;
        continue;
      }
      return new Response(opts.method === "HEAD" ? null : (r.body ?? ""), { status: r.status ?? 200, headers: { "content-type": "text/html", ...(r.headers ?? {}) } });
    }
    throw new TypeError("too many redirects");
  };
}
const page = ({ canonical = null, ogUrl = null, robots = null, links = [] } = {}) =>
  `<!doctype html><html><head>${canonical ? `<link rel="canonical" href="${canonical}">` : ""}${ogUrl ? `<meta property="og:url" content="${ogUrl}">` : ""}${robots ? `<meta name="robots" content="${robots}">` : ""}</head><body><h1>Titre</h1>${links.map((l) => `<a href="${l}">lien</a>`).join("")}</body></html>`;
const sitemap = (urls) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

console.log("── Ce qui ne se voit qu'en ligne ──");
{
  const S = "https://example.fr";
  const broken = fakeSite(
    {
      [`${S}/`]: { body: page({ canonical: `${S}/`, ogUrl: "http://localhost:3000/", links: ["/a", "/b", "/missing", "mailto:jo@example.fr", "#haut", "https://ailleurs.example/x"] }) },
      [`${S}/robots.txt`]: { body: "User-agent: *\nAllow: /\n" },
      [`${S}/sitemap.xml`]: { body: sitemap([`${S}/`, `${S}/a`, `${S}/ancien`, `${S}/cache`, `${S}/parti`, `${S}/copie`]) },
      [`${S}/a`]: { body: page({ canonical: `${S}/a` }) },
      [`${S}/ancien`]: { status: 307, redirect: `${S}/a` },
      [`${S}/cache`]: { body: page({ robots: "noindex, follow" }) },
      [`${S}/parti`]: { status: 404, body: "<h1>404</h1>" },
      [`${S}/copie`]: { body: page({ canonical: `${S}/a` }) },
      [`${S}/b`]: { body: page(), headers: { "x-robots-tag": "noindex" } },
      [`${S}/missing`]: { status: 404, body: "<h1>404</h1>" },
      ["http://example.fr/"]: { status: 302, redirect: `${S}/` },
      ["https://www.example.fr/"]: { body: page() },
      ["https://exemple-site.vercel.app/"]: { body: page({ canonical: "https://exemple-site.vercel.app/" }) },
    },
    (u) => (u.startsWith(`${S}/hv-`) ? { body: page() } : null),
  );
  const r = await live.check({ url: S, vercel: "exemple-site.vercel.app", fetchImpl: broken });
  const has = (c, url) => r.findings.some((f) => f.check === c && (!url || f.url === url));
  check("the site read", r.reachable === true && r.pagesRead === 6, JSON.stringify(r).slice(0, 300));
  check("an og:url that names this machine", has("local-address", `${S}/`));
  check("robots.txt that names no sitemap", has("robots-no-sitemap"));
  check("the sitemap lists an address that redirects, a page kept out of the index, a missing page, a page whose canonical is another", has("sitemap-redirect", `${S}/ancien`) && has("sitemap-noindex", `${S}/cache`) && has("sitemap-error", `${S}/parti`) && has("sitemap-not-canonical", `${S}/copie`));
  check("a linked page kept out of the index by its X-Robots-Tag header: said, lower (it may be meant)", r.findings.some((f) => f.check === "noindex-linked" && f.url === `${S}/b` && f.severity === "low"));
  const hidden = fakeSite({ [`${S}/`]: { body: page({ robots: "noindex" }) }, [`${S}/robots.txt`]: { body: `User-agent: *\nAllow: /\nSitemap: ${S}/sitemap.xml\n` } }, () => null);
  const h = await live.check({ url: S, fetchImpl: hidden });
  check("the home page kept out of the index: said, high", h.findings.some((f) => f.check === "noindex" && f.url === `${S}/` && f.severity === "high"));
  check("an internal link that leads nowhere (mail, anchors and other sites left aside)", has("broken-link", `${S}/missing`) && !r.findings.some((f) => /mailto|ailleurs|#haut/.test(f.url)));
  check("a page that does not exist answering 200 (soft 404)", has("soft-404"));
  check("http to https by a temporary redirect", has("temporary-redirect", "http://example.fr/"));
  check("the www address answering the site itself", has("duplicate-host", "https://www.example.fr/"));
  check("the *.vercel.app address doubling the site", has("vercel-duplicate", "https://exemple-site.vercel.app/"));

  const clean = fakeSite(
    {
      [`${S}/`]: { body: page({ canonical: `${S}/`, ogUrl: `${S}/`, links: ["/a"] }) },
      [`${S}/robots.txt`]: { body: `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${S}/sitemap.xml\n` },
      [`${S}/sitemap.xml`]: { body: sitemap([`${S}/`, `${S}/a`]) },
      [`${S}/a`]: { body: page({ canonical: `${S}/a` }) },
      ["http://example.fr/"]: { status: 308, redirect: `${S}/` },
      ["https://www.example.fr/"]: { status: 301, redirect: `${S}/` },
      ["https://exemple-site.vercel.app/"]: { status: 308, redirect: `${S}/` },
    },
    (u) => (u.startsWith(`${S}/hv-`) ? { status: 404, body: "<h1>404</h1>" } : null),
  );
  const ok = await live.check({ url: S, vercel: "exemple-site.vercel.app", fetchImpl: clean });
  check("a sound site: nothing to report (308 and 301 are permanent alike)", ok.reachable && ok.findings.length === 0, JSON.stringify(ok.findings));
  const closed = fakeSite({ [`${S}/`]: { body: page() }, [`${S}/robots.txt`]: { body: "User-agent: *\nDisallow: /\n" } }, () => null);
  const c = await live.check({ url: S, fetchImpl: closed });
  check("robots.txt that closes the whole site", c.findings.some((f) => f.check === "robots-closed"));
  const marked = fakeSite({ [`${S}/`]: { body: page({ canonical: `${S}/` }) }, [`${S}/robots.txt`]: { body: `User-agent: *\nAllow: /\nSitemap: ${S}/sitemap.xml\n` } }, (u) => (u.startsWith(`${S}/hv-`) ? { body: page({ robots: "noindex" }) } : null));
  const m = await live.check({ url: S, fetchImpl: marked });
  check("a missing page answered 200 but marked noindex (Next.js once streaming started): not a soft 404", !m.findings.some((f) => f.check === "soft-404"));
  const down = await live.check({ url: S, fetchImpl: fakeSite({}, () => null) });
  check("a site that cannot be reached: said, never \"nothing to report\"", down.reachable === false);
}

console.log("\n── Le score sur une grille fixe ──");
{
  const dir = mkdtempSync(join(tmpdir(), "hv-report-"));
  try {
    const grids = report.loadGrids();
    for (const skill of ["seo", "geo"]) {
      const g = grids[skill];
      const ids = g.checks.map((c) => c.id);
      check(`${skill}: a grid with an id, every check weighted once`, /^[a-z]+-\d{4}-\d{2}$/.test(g.id) && new Set(ids).size === ids.length && g.checks.every((c) => Number.isInteger(c.weight) && c.weight >= 0 && c.label));
    }
    const g = grids.seo;
    const all = (status) => Object.fromEntries(g.checks.map((c) => [c.id, { status }]));
    let r = report.record("seo", { checks: all("ok") }, { webDir: dir, today: "2026-10-14", site: "https://example.fr" });
    const max = g.checks.reduce((n, c) => n + c.weight, 0);
    check("everything right: the whole of the grid", r.score.points === max && r.score.max === max && r.score.percent === 100 && r.previous === null);
    const half = all("ok");
    half["meta.titles"] = { status: "warn", note: "deux pages ont le même titre" };
    half["data.local"] = { status: "na", note: "pas un commerce" };
    half["live.links"] = { status: "fail" };
    r = report.record("seo", { checks: half }, { webDir: dir, today: "2026-10-21" });
    const weight = (id) => g.checks.find((c) => c.id === id).weight;
    check("warn counts half, fail nothing, na leaves the check out of the maximum", r.score.max === max - weight("data.local") && r.score.points === max - weight("data.local") - weight("live.links") - weight("meta.titles") / 2);
    check("... the pass before is kept as the reference", r.previous?.date === "2026-10-14" && r.previous.score.percent === 100);
    r = report.record("seo", { checks: half }, { webDir: dir, today: "2026-10-21" });
    check("a second pass the same day replaces the first, and keeps its reference", r.previous?.date === "2026-10-14");
    const saved = JSON.parse(readFileSync(join(dir, ".hypervibe", "seo-report.json"), "utf8"));
    check("kept in the project, in .hypervibe/seo-report.json, each check with its note", saved.seo.grid === g.id && saved.seo.checks["meta.titles"].note === "deux pages ont le même titre" && saved.seo.site === undefined);
    let e = null;
    try {
      report.record("seo", { checks: { ...half, "meta.inventee": { status: "ok" } } }, { webDir: dir });
    } catch (x) {
      e = x;
    }
    check("a check outside the grid: refused, nothing written", e?.exit === report.EXIT.USAGE && /meta\.inventee/.test(e.message));
    const partial = { ...half };
    delete partial["tech.robots"];
    e = null;
    try {
      report.record("seo", { checks: partial }, { webDir: dir });
    } catch (x) {
      e = x;
    }
    check("a check of the grid left without a status: refused (na when it does not apply)", e?.exit === report.EXIT.USAGE && /tech\.robots/.test(e.message));
    e = null;
    try {
      report.record("seo", { checks: { ...half, "meta.titles": { status: "good" } } }, { webDir: dir });
    } catch (x) {
      e = x;
    }
    check("an unknown status: refused", e?.exit === report.EXIT.USAGE);
    const geoChecks = Object.fromEntries(grids.geo.checks.map((c) => [c.id, { status: c.weight === 0 ? "fail" : "ok" }]));
    r = report.record("geo", { checks: geoChecks }, { webDir: dir, today: "2026-10-21" });
    check("a check of weight 0 is recorded without counting (a bet, a measure)", r.score.percent === 100);
    let c = report.citations({ questions: [{ question: "Où apprendre la céramique à Lyon ?", results: { chatgpt: "cited", perplexity: "not-cited", claude: "not-asked" } }, { question: "Cours de poterie pour enfants ?", results: { chatgpt: "not-cited" } }] }, { webDir: dir, today: "2026-10-21" });
    check("the guided check of citations recorded: questions cited at least once", c.cited === 1 && c.asked === 2 && c.previous === null);
    c = report.citations({ questions: [{ question: "Où apprendre la céramique à Lyon ?", results: { chatgpt: "cited" } }] }, { webDir: dir, today: "2026-11-21" });
    check("... and compared with the time before", c.previous?.date === "2026-10-21" && c.previous.cited === 1);
    r = report.record("geo", { checks: geoChecks }, { webDir: dir, today: "2026-11-22" });
    const kept = JSON.parse(readFileSync(join(dir, ".hypervibe", "seo-report.json"), "utf8"));
    check("a new /geo pass keeps the citations recorded", kept.geo.citations?.date === "2026-11-21" && kept.seo.grid === g.id);
    e = null;
    try {
      report.citations({ questions: [{ question: "Q ?", results: { chatgpt: "maybe" } }] }, { webDir: dir });
    } catch (x) {
      e = x;
    }
    check("an answer other than cited, not-cited, not-asked: refused", e?.exit === report.EXIT.USAGE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  check("no report written outside the project's folder", !existsSync(join(ROOT, ".hypervibe", "seo-report.json")));
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
