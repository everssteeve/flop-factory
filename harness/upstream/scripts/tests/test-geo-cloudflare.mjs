#!/usr/bin/env node
// test-geo-cloudflare.mjs - /geo reads whether Cloudflare turns AI robots away (3.4.12,
// scripts/geo/cloudflare-ai.mjs), against a fake Cloudflare on the loopback: the zone found for a
// subdomain, the records proxied or not (the policies only act on what Cloudflare carries), the
// policies read and what they mean (a Block on search also takes the site out of the search
// engines since September 2026), a token without the right to read them (the dashboard's
// procedure instead), and nothing ever written. No network, no vault.
//
//   node scripts/tests/test-geo-cloudflare.mjs

import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cfai = await import(pathToFileURL(join(ROOT, "scripts", "geo", "cloudflare-ai.mjs")).href);

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 400)})`}`);
}

const KEY = "jeton-de-recette";
let world = {};
const calls = [];
const server = createServer((req, res) => {
  calls.push(`${req.method} ${req.url}`);
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const ok = (result) => send(200, { success: true, errors: [], result });
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/client\/v4/, "");
  if (path === "/zones") return ok((world.zones ?? []).filter((z) => z.name === url.searchParams.get("name")));
  const m = /^\/zones\/([^/]+)\/(dns_records|bot_management)$/.exec(path);
  if (m && m[2] === "dns_records") return ok((world.records ?? []).filter((r) => r.name === url.searchParams.get("name")));
  if (m && m[2] === "bot_management") {
    if (world.botRefused) return send(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
    return ok(world.bot ?? {});
  }
  return send(404, { success: false, errors: [{ code: 7003, message: "Could not route" }] });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const env = { HYPERVIBE_CLOUDFLARE_API: `http://127.0.0.1:${server.address().port}`, CLOUDFLARE_API_TOKEN: KEY };
const run = (domain) => cfai.main(["--domain", domain], env);

try {
  world = {
    zones: [{ id: "z1", name: "example.fr" }],
    records: [
      { type: "A", name: "example.fr", proxied: true },
      { type: "CNAME", name: "www.example.fr", proxied: true },
      { type: "MX", name: "example.fr" },
    ],
    bot: { ai_search: "block", ai_user: "allow", ai_training: "disallow", ai_bots_protection: "disabled", bot_preference_sync_enabled: true, is_robots_txt_managed: true },
  };
  let r = await run("example.fr");
  check("the zone and its proxied records read: the policies apply to the site", r.code === cfai.EXIT.OK && r.out.zone === "example.fr" && r.out.carried === true && r.out.proxied["example.fr"] === true && r.out.proxied["www.example.fr"] === true, JSON.stringify(r.out));
  check("the policies read by family (search, agent, training), the older switch, the robots.txt Cloudflare manages", r.out.readable === true && r.out.policies.search === "block" && r.out.policies.training === "disallow" && r.out.policies.legacy === "disabled" && r.out.policies.managedRobotsTxt === true);
  check("a Block on search said high, with what it now does (Google's, Bing's and Apple's search robots too)", r.out.findings.some((f) => f.family === "search" && f.severity === "high" && /Google's, Bing's and Apple's/.test(f.what)));
  check("training disallowed through robots.txt is not a fault; Cloudflare's own robots.txt rules are said", !r.out.findings.some((f) => f.family === "training") && r.out.findings.some((f) => f.family === "robots.txt"));
  check("only reads: every call a GET", calls.every((c) => c.startsWith("GET ")));

  world.records = [{ type: "CNAME", name: "example.fr", proxied: false }];
  world.bot = { ai_search: "block" };
  r = await run("example.fr");
  check("records that are DNS only: the policies do not touch the site, said", r.code === cfai.EXIT.OK && r.out.carried === false && r.out.appliesToSite === false);

  world.records = [{ type: "A", name: "app.example.fr", proxied: true }];
  world.bot = { ai_bots_protection: "block" };
  r = await run("app.example.fr");
  check("a subdomain: the zone it falls under, its own records", r.out.zone === "example.fr" && r.out.proxied["app.example.fr"] === true);
  check("the older Block AI bots switch on: said high (it turns away the robots that cite too)", r.out.findings.some((f) => f.family === "legacy" && f.severity === "high"));

  world.botRefused = true;
  r = await run("example.fr");
  check("a token without the right to read the policies: read anyway for the rest, the dashboard's procedure given", r.code === cfai.EXIT.OK && r.out.readable === false && r.out.policies === null && /Configure AI bot policies/.test(r.out.procedure) && /Bot Management/.test(r.out.procedure));
  world.botRefused = false;

  world.zones = [];
  r = await run("ailleurs.fr");
  check("no zone at Cloudflare: said, Cloudflare's settings do not touch the site", r.code === cfai.EXIT.UNREADABLE && /does not touch it|do not touch it/.test(r.out.error));

  r = await cfai.main(["--domain", "Example.FR/"], env);
  check("a domain written wrongly: refused, nothing asked", r.code === cfai.EXIT.USAGE);

  let asked = 0;
  const k = cfai.readKey({ CLOUDFLARE_API_TOKEN: "x", HYPERVIBE_CLOUDFLARE_API: "https://evil.example" }, cfai.apiBase({ HYPERVIBE_CLOUDFLARE_API: "https://evil.example" }), () => {
    asked += 1;
    return { status: 4, value: "" };
  });
  check("Cloudflare is the real one unless a recette names its loopback, and its key is never the environment's", asked === 1 && !k.key && k.code === cfai.EXIT.NO_KEY);
} finally {
  server.close();
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
