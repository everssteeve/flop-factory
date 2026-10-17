#!/usr/bin/env node
// test-gsc-opportunities.mjs - Search Console's opportunities, read once for /gsc and /seo (3.4.12,
// scripts/gsc/opportunities.mjs): the property found as Search Console names it, the period that
// ends three days ago, the queries just outside the first page and those seen but rarely clicked,
// each page's figures, the totals; against a fake on the loopback. The vault is never reached: the
// token of the environment is taken for the fake only, and Google's real token is forged by a
// stand-in here.
//
//   node scripts/tests/test-gsc-opportunities.mjs

import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 400)})`}`);
}

console.log("\n── Les opportunités de Search Console ──");
{
  const opp = await import(pathToFileURL(join(ROOT, "scripts", "gsc", "opportunities.mjs")).href);
  const rows = [
    { keys: ["cours ceramique lyon", "https://example.fr/"], clicks: 4, impressions: 300, ctr: 0.0133, position: 14.2 },
    { keys: ["atelier poterie", "https://example.fr/cours"], clicks: 1, impressions: 220, ctr: 0.0045, position: 3.1 },
    { keys: ["tour de potier", "https://example.fr/cours"], clicks: 30, impressions: 200, ctr: 0.15, position: 2 },
    { keys: ["argile", "https://example.fr/"], clicks: 0, impressions: 5, ctr: 0, position: 15 },
  ];
  let asked = 0;
  const server = createServer((req, res) => {
    asked += 1;
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.headers.authorization !== "Bearer jeton-de-recette") return res.end(JSON.stringify({ error: { code: 401 } }));
      if (req.url === "/webmasters/v3/sites") return res.end(JSON.stringify({ siteEntry: [{ siteUrl: "sc-domain:example.fr", permissionLevel: "siteFullUser" }] }));
      if (req.url.startsWith("/webmasters/v3/sites/sc-domain%3Aexample.fr/searchAnalytics/query")) {
        const body = JSON.parse(raw);
        if (!body.dimensions) return res.end(JSON.stringify({ rows: [{ clicks: 41, impressions: 812, ctr: 0.05, position: 9.4 }] }));
        return res.end(JSON.stringify({ rows: body.dimensions.join() === "query,page" ? rows : [] }));
      }
      res.end(JSON.stringify({}));
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const env = { HYPERVIBE_GSC_API: `http://127.0.0.1:${server.address().port}`, GSC_TOKEN: "jeton-de-recette" };
  try {
    let r = await opp.main(["--domain", "example.fr"], env, new Date("2026-10-14T12:00:00Z"));
    check("the property found as Search Console names it, the period ending three days ago", r.code === opp.EXIT.OK && r.out.property === "sc-domain:example.fr" && r.out.period.end === "2026-10-11" && r.out.period.start === "2026-09-14");
    check("positions 11 to 20 with enough impressions: the first opportunity", r.out.nearTop.length === 1 && r.out.nearTop[0].query === "cours ceramique lyon");
    check("seen on the first page, rarely clicked: a title to rewrite", r.out.lowCtr.length === 1 && r.out.lowCtr[0].query === "atelier poterie" && r.out.lowCtr[0].page === "https://example.fr/cours");
    check("each page's figures, its position weighted by impressions", r.out.pages.find((p) => p.page === "https://example.fr/cours")?.impressions === 420);
    check("the totals from a query without dimensions (the rows by query leave the anonymous queries out)", r.out.totals?.impressions === 812 && r.out.totals.clicks === 41);
    r = await opp.main(["--domain", "autre.fr"], env);
    check("a site that is not a property: said (6), /gsc named", r.code === opp.EXIT.NO_PROPERTY && /\/gsc/.test(r.out.error));
    let forged = 0;
    const t = opp.token({ GSC_TOKEN: "x" }, opp.apiBase({ HYPERVIBE_GSC_API: "https://evil.example" }), () => {
      forged += 1;
      return { status: 4, stdout: "" };
    });
    check("Google is the real one unless a recette names its loopback, and the environment's token is never taken for it", opp.apiBase({ HYPERVIBE_GSC_API: "https://evil.example" }) === "https://www.googleapis.com/webmasters/v3" && forged === 1 && !t.token && t.code === opp.EXIT.NOT_SET_UP);
    r = await opp.main(["--domain", "https://example.fr/page"], env);
    check("a domain given as an address: refused, nothing asked", r.code === opp.EXIT.ERROR && /Usage/.test(r.out.error));
  } finally {
    server.close();
  }
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
