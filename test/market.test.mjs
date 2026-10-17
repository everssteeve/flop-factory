import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harden, hasFactoryCsp, cspFor } from "../scripts/lib/harden.mjs";
import { measureCode, COUNTER_JS } from "../scripts/lib/measure.mjs";
import { assemble, injectDescription } from "../scripts/assemble-site.mjs";
import { arbitrate } from "../scripts/arbiter.mjs";
import { verdicts, usedVisitors } from "../scripts/verdict-j30.mjs";
import { validateDiscovered } from "../scripts/merge-records.mjs";
import { claudeArgs, DISCOVERY_TOOLS } from "../scripts/lib/claude-args.mjs";
import { checkDiscovered } from "../scripts/lib/apps.mjs";

const repo = join(import.meta.dirname, "..");
const FIXTURE = join(import.meta.dirname, "fixtures", "good-app");
const NOW = new Date("2026-11-20T06:00:00Z");
const ENV = { GOATCOUNTER_CODE: "flopfactory", GOATCOUNTER_TOKEN: "t0k" };

// --- Mesure -----------------------------------------------------------------

test("politique de sécurité : une seule origine de comptage, validée, remplace l'ancienne", () => {
  assert.throws(() => cspFor({ countOrigin: "https://evil.example" }), /refusée/);
  assert.throws(() => cspFor({ countOrigin: "https://x.goatcounter.com.evil.example" }), /refusée/);
  const html = harden(readFileSync(join(FIXTURE, "index.html"), "utf8"));
  const counted = harden(html, { countOrigin: "https://flopfactory.goatcounter.com" });
  assert.equal((counted.match(/Content-Security-Policy/g) ?? []).length, 1, "une seule politique");
  assert.ok(hasFactoryCsp(counted, { countOrigin: "https://flopfactory.goatcounter.com" }));
  assert.match(counted, /img-src 'self' data: https:\/\/flopfactory\.goatcounter\.com;/);
  assert.match(counted, /connect-src 'none'/);
});

test("code de mesure : format strict, sinon pas de mesure", () => {
  assert.equal(measureCode({ GOATCOUNTER_CODE: "flopfactory" }), "flopfactory");
  assert.equal(measureCode({ GOATCOUNTER_CODE: "evil.com/x" }), null);
  assert.equal(measureCode({}), null);
});

function liveData() {
  const data = mkdtempSync(join(tmpdir(), "ff-data-"));
  const v = mkdtempSync(join(tmpdir(), "ff-v-"));
  mkdirSync(join(v, "site"));
  for (const f of ["index.html", "style.css", "app.js", "test.mjs"]) cpSync(join(FIXTURE, f), join(v, "site", f));
  writeFileSync(join(v, "site", "index.html"), harden(readFileSync(join(FIXTURE, "index.html"), "utf8")));
  writeFileSync(join(v, "gate.json"), JSON.stringify({ slug: "tirage-equipes", passed: true, problems: [] }));
  writeFileSync(join(v, "review.json"), JSON.stringify({ score: 8, blocking: [], notes: [] }));
  cpSync(join(FIXTURE, "spec.json"), join(v, "spec.json"));
  arbitrate({ root: repo, data, slug: "tirage-equipes", stage: "done", verdict: v, now: new Date("2026-10-17T14:00:00Z") });
  return data;
}

test("assemblage avec mesure : compteur, politique ouverte à la seule image, mentions, sitemap", () => {
  const out = join(mkdtempSync(join(tmpdir(), "ff-pub-")), "p");
  assemble(repo, liveData(), out, { env: ENV });
  const page = readFileSync(join(out, "apps", "tirage-equipes", "index.html"), "utf8");
  assert.match(page, /<script src="\.\.\/\.\.\/ff-count\.js" data-origin="https:\/\/flopfactory\.goatcounter\.com" data-slug="tirage-equipes"><\/script><\/body>/);
  assert.equal((page.match(/Content-Security-Policy/g) ?? []).length, 1);
  assert.match(page, /<meta name="description" content="Répartir une liste/);
  assert.ok(existsSync(join(out, "ff-count.js")));
  assert.match(readFileSync(join(out, "mentions-legales.html"), "utf8"), /Mesure d'audience/);
  const sitemap = readFileSync(join(out, "sitemap.xml"), "utf8");
  assert.match(sitemap, /https:\/\/everssteeve\.github\.io\/flop-factory\/apps\/tirage-equipes\//);
  assert.match(readFileSync(join(out, "robots.txt"), "utf8"), /Sitemap: https:\/\/everssteeve\.github\.io\/flop-factory\/sitemap\.xml/);
});

test("assemblage sans mesure : ni compteur, ni ouverture de la politique, ni mention", () => {
  const out = join(mkdtempSync(join(tmpdir(), "ff-pub-")), "p");
  assemble(repo, liveData(), out, { env: {} });
  const page = readFileSync(join(out, "apps", "tirage-equipes", "index.html"), "utf8");
  assert.ok(!page.includes("ff-count.js"));
  assert.ok(hasFactoryCsp(page));
  assert.ok(!existsSync(join(out, "ff-count.js")));
  assert.doesNotMatch(readFileSync(join(out, "mentions-legales.html"), "utf8"), /Mesure d'audience/);
});

test("méta description échappée et jamais doublée", () => {
  assert.equal(injectDescription("<title>x</title>", '"><script>'), '<title>x</title><meta name="description" content="&quot;&gt;&lt;script&gt;">');
  const already = '<title>x</title><meta name="description" content="a">';
  assert.equal(injectDescription(already, "b"), already);
});

let chromium = null;
try {
  const mod = process.env.FF_PLAYWRIGHT ? await import(process.env.FF_PLAYWRIGHT) : await import("playwright");
  chromium = mod.chromium ?? mod.default?.chromium;
} catch {}
if (process.env.FF_REQUIRE_ALL && !chromium) throw new Error("playwright requis en CI");

async function counterRun({ dnt = false, webdriver = false } = {}) {
  const browser = await chromium.launch({ chromiumSandbox: process.getuid?.() !== 0 });
  const page = await browser.newPage();
  const hits = [];
  await page.route("https://flopfactory.goatcounter.com/**", (r) => {
    hits.push(new URL(r.request().url()));
    return r.fulfill({ status: 200, contentType: "image/gif", body: "" });
  });
  await page.route("https://app.test/**", (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.endsWith("ff-count.js")) return r.fulfill({ contentType: "text/javascript", body: COUNTER_JS });
    return r.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head></head><body><input id="i"><script src="/ff-count.js" data-origin="https://flopfactory.goatcounter.com" data-slug="tirage-equipes"></script></body></html>`,
    });
  });
  await page.addInitScript(({ dnt, webdriver }) => {
    Object.defineProperty(navigator, "webdriver", { get: () => webdriver });
    Object.defineProperty(navigator, "doNotTrack", { get: () => (dnt ? "1" : null) });
  }, { dnt, webdriver });
  await page.goto("https://app.test/");
  await page.fill("#i", "secret saisi");
  await page.click("#i");
  await page.waitForTimeout(300);
  await browser.close();
  return hits;
}

test("compteur : une ouverture puis une seule utilisation, rien de ce qui est saisi", { skip: !chromium && "playwright absent" }, async () => {
  const hits = await counterRun();
  assert.deepEqual(hits.map((u) => [u.searchParams.get("p"), u.searchParams.get("e")]), [["/apps/tirage-equipes/", null], ["used-tirage-equipes", "true"]]);
  assert.ok(hits.every((u) => !u.href.includes("secret")));
});

test("compteur : silencieux avec Do Not Track ou sous robot", { skip: !chromium && "playwright absent" }, async () => {
  assert.deepEqual(await counterRun({ dnt: true }), []);
  assert.deepEqual(await counterRun({ webdriver: true }), []);
});

// --- Verdict J+30 -----------------------------------------------------------

function apiReturning(count, { ok = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: new URL(url), auth: opts.headers.Authorization });
    return { ok, json: async () => ({ hits: count === null ? [] : [{ path: "used-tirage-equipes", count, event: true }], total: count ?? 0 }) };
  };
  return { fetchImpl, calls };
}

function measuredSince(data, since) {
  mkdirSync(join(data, "factory"), { recursive: true });
  writeFileSync(join(data, "factory", "measure.json"), JSON.stringify({ since }));
}

const state = (data) => JSON.parse(readFileSync(join(data, "factory", "apps", "tirage-equipes.json"), "utf8"));

test("J+30 : sans mesure configurée, aucun verdict ; au premier passage, la mesure démarre", async () => {
  const data = liveData();
  assert.match((await verdicts({ root: repo, data, env: {}, now: NOW })).note, /non configurée/);
  assert.match((await verdicts({ root: repo, data, env: ENV, now: NOW, fetchImpl: apiReturning(0).fetchImpl })).note, /démarrée/);
  assert.equal(JSON.parse(readFileSync(join(data, "factory", "measure.json"), "utf8")).since, NOW.toISOString());
  assert.equal(state(data).status, "live");
});

test("J+30 : la fenêtre doit être entièrement mesurée", async () => {
  const data = liveData();
  measuredSince(data, "2026-11-01T00:00:00Z"); // app en ligne depuis le 17/10, mesure depuis le 01/11
  const api = apiReturning(0);
  const out = await verdicts({ root: repo, data, env: ENV, now: NOW, fetchImpl: api.fetchImpl });
  assert.deepEqual(out.killed, []);
  assert.equal(api.calls.length, 0);
});

test("J+30 : sous le seuil → retirée du catalogue ; au-dessus → gardée, verdict rendu une fois", async () => {
  const data = liveData();
  measuredSince(data, "2026-10-01T00:00:00Z");
  const api = apiReturning(3);
  const out = await verdicts({ root: repo, data, env: ENV, now: NOW, fetchImpl: api.fetchImpl });
  assert.deepEqual(out.killed, ["tirage-equipes"]);
  assert.equal(api.calls[0].auth, "Bearer t0k");
  assert.equal(api.calls[0].url.hostname, "flopfactory.goatcounter.com");
  assert.equal(api.calls[0].url.searchParams.get("include_paths"), "used-tirage-equipes");
  assert.equal(state(data).status, "killed");
  const pub = join(mkdtempSync(join(tmpdir(), "ff-pub-")), "p");
  assert.deepEqual(assemble(repo, data, pub, { env: ENV }), []);

  const data2 = liveData();
  measuredSince(data2, "2026-10-01T00:00:00Z");
  assert.deepEqual((await verdicts({ root: repo, data: data2, env: ENV, now: NOW, fetchImpl: apiReturning(25).fetchImpl })).kept, ["tirage-equipes"]);
  const again = apiReturning(0);
  await verdicts({ root: repo, data: data2, env: ENV, now: NOW, fetchImpl: again.fetchImpl });
  assert.equal(again.calls.length, 0, "verdict déjà rendu");
  assert.equal(state(data2).status, "live");
});

test("J+30 : API en panne ou réponse douteuse → aucun retrait", async () => {
  for (const fetchImpl of [apiReturning(0, { ok: false }).fetchImpl, async () => { throw new Error("réseau"); }, async () => ({ ok: true, json: async () => ({}) })]) {
    const data = liveData();
    measuredSince(data, "2026-10-01T00:00:00Z");
    assert.deepEqual((await verdicts({ root: repo, data, env: ENV, now: NOW, fetchImpl })).killed, []);
    assert.equal(state(data).status, "live");
  }
  assert.equal(await usedVisitors({ code: "c", token: "t", slug: "x", start: NOW, end: NOW, fetchImpl: async () => ({ ok: true, json: async () => ({ hits: [{ path: "used-x", count: -1 }] }) }) }), null);
});

// --- Découverte ---------------------------------------------------------------

const blocklist = JSON.parse(readFileSync(join(repo, "factory", "blocklist.json"), "utf8"));
const FIND = { slug: "minuteur-oeufs", idea: "Choisir la cuisson d'un oeuf (coque, mollet, dur) et lancer le minuteur correspondant.", evidence: "Question récurrente sur les forums de cuisine." };

test("idées découvertes : sujets interdits filtrés, accents compris, sans faux positifs grossiers", () => {
  assert.deepEqual(checkDiscovered(FIND, new Set(), blocklist), []);
  const banned = ["Calculer ses impôts du mois", "Résultats d'élection municipale en direct", "Fiches de révision pour élèves", "Suivi de grossesse semaine par semaine", "Pronostics de paris sportifs du week-end"];
  for (const idea of banned) assert.ok(checkDiscovered({ ...FIND, idea: idea.padEnd(45, ".") }, new Set(), blocklist).some((p) => p.startsWith("sujet interdit")), idea);
  const fine = ["Comparer le prix au kilo de deux paquets au supermarché", "Planifier un week-end à Paris avec une liste à cocher", "Compter les points d'une partie de belote entre amis"];
  for (const idea of fine) assert.deepEqual(checkDiscovered({ ...FIND, idea }, new Set(), blocklist), [], idea);
});

test("fusion : les idées découvertes doivent prolonger le fichier et repasser les filtres", () => {
  const root = mkdtempSync(join(tmpdir(), "ff-root-"));
  for (const p of ["factory/config.json", "factory/ideas.json", "factory/blocklist.json"]) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    cpSync(join(repo, p), join(root, p));
  }
  assert.deepEqual(validateDiscovered(root, { ideas: [FIND] }, 200).ideas, [FIND]);
  writeFileSync(join(root, "factory", "ideas-discovered.json"), JSON.stringify({ ideas: [FIND] }));
  assert.throws(() => validateDiscovered(root, { ideas: [] }, 200), /longueur/);
  assert.throws(() => validateDiscovered(root, { ideas: [{ ...FIND, idea: FIND.idea + " (modifiée)" }] }, 200), /réécrite/);
  assert.throws(() => validateDiscovered(root, { ideas: [FIND, { ...FIND, slug: "casino-maison", idea: "Organiser une soirée casino à la maison avec jetons et règles." }] }, 200), /sujet interdit/);
  assert.throws(() => validateDiscovered(root, { ideas: [FIND, { ...FIND }] }, 200), /déjà connue/);
});

test("atelier Découverte : recherche web sans shell, et aucun autre jeu d'outils", () => {
  const base = { prompt: "p", model: "haiku", capUsd: 0.1, maxTurns: 5, pluginDir: "/p", rulesFile: "/r", settingsFile: "/s" };
  const args = claudeArgs({ ...base, tools: DISCOVERY_TOOLS });
  assert.equal(args[args.indexOf("--tools") + 1], "WebSearch,Read,Write");
  assert.ok(!args.join(" ").includes("Bash"));
  assert.throws(() => claudeArgs({ ...base, tools: "Bash,WebFetch" }), /non prévu/);
  const settings = JSON.parse(readFileSync(join(repo, "harness", "overlay", "run-settings-discovery.json"), "utf8"));
  assert.ok(settings.permissions.deny.includes("WebFetch"));
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
});
