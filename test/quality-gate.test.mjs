import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSite, scanSecrets, checkAcceptance, runGate } from "../scripts/quality-gate.mjs";
import { sandboxAvailable, runSandboxed } from "../scripts/lib/sandbox.mjs";
import { collectFiles } from "../scripts/lib/site-files.mjs";

const repo = join(import.meta.dirname, "..");
const FIXTURE = join(import.meta.dirname, "fixtures", "good-app");
const LIMITS = JSON.parse(readFileSync(join(repo, "factory", "config.json"), "utf8")).pipeline;
const PUBLISHED = ["app.js", "index.html", "style.css", "test.mjs"];
const SANDBOX = sandboxAvailable();
// En CI, rien ne doit être sauté : un test de la porte sauté est une porte non testée.
if (process.env.FF_REQUIRE_ALL && !SANDBOX) throw new Error("bubblewrap requis en CI");
const noBrowser = async () => [];

function app(edit = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ff-gate-"));
  cpSync(FIXTURE, dir, { recursive: true });
  for (const [f, c] of Object.entries(edit)) writeFileSync(join(dir, f), typeof c === "function" ? c(readFileSync(join(dir, f), "utf8")) : c);
  return dir;
}

test("contrôles statiques : l'app de référence passe", () => {
  assert.deepEqual(checkSite(app(), PUBLISHED), []);
});

test("contrôles statiques : ressources externes, localhost, cookie, langue", () => {
  const ext = app({ "index.html": (h) => h.replace("</body>", '<script src="https://evil.example/x.js"></script></body>') });
  assert.ok(checkSite(ext, PUBLISHED).includes("ressource externe dans index.html"));
  const proto = app({ "index.html": (h) => h.replace("</head>", '<link rel="stylesheet" href="//cdn.example/x.css"></head>') });
  assert.ok(checkSite(proto, PUBLISHED).includes("ressource externe dans index.html"));
  const css = app({ "style.css": "@import url('https://fonts.example/f.css');" });
  assert.ok(checkSite(css, PUBLISHED).includes("ressource externe dans style.css"));
  const local = app({ "index.html": (h) => h.replace("</body>", '<a href="http://localhost:3000">x</a></body>') });
  assert.ok(checkSite(local, PUBLISHED).includes("lien localhost dans la page"));
  const cookie = app({ "app.js": (j) => j + "\ndocument.cookie='a=b';" });
  assert.ok(checkSite(cookie, PUBLISHED).includes("cookie dans app.js"));
  const lang = app({ "index.html": (h) => h.replace('lang="fr"', 'lang="en"') });
  assert.ok(checkSite(lang, PUBLISHED).includes("langue de la page non déclarée en français"));
  // Un simple lien sortant reste permis.
  const link = app({ "index.html": (h) => h.replace("</main>", '<a href="https://fr.wikipedia.org">source</a></main>') });
  assert.deepEqual(checkSite(link, PUBLISHED), []);
});

test("fichiers transportés : à plat, extensions et taille bornées, pas de lien symbolique", () => {
  const dir = app({ "evil.sh": "rm -rf /" });
  symlinkSync("/etc/passwd", join(dir, "passwd.txt"));
  mkdirSync(join(dir, "sub"));
  const { problems } = collectFiles(dir, LIMITS);
  assert.ok(problems.includes("extension refusée : evil.sh"));
  assert.ok(problems.includes("lien symbolique refusé : passwd.txt"));
  assert.ok(problems.includes("sous-dossier refusé : sub"));
  const big = app({ "big.txt": "x".repeat(LIMITS.maxSiteBytes + 1) });
  assert.ok(collectFiles(big, LIMITS).problems.some((p) => p.startsWith("app trop lourde")));
});

test("un secret dans l'app bloque", () => {
  const dir = app({ "config.json": '{"k":"sk-ant-api03-abcdefghijklmnop"}' });
  assert.equal(scanSecrets(dir, ["config.json"])[0].pattern, "anthropic");
});

test("sandbox : pas de réseau, pas d'écriture hors copie, environnement vidé", { skip: !SANDBOX && "bubblewrap absent" }, () => {
  const dir = app({
    "probe.mjs": `import { writeFileSync } from "node:fs";
let wrote = "no"; try { writeFileSync(${JSON.stringify(join(repo, "PWNED"))}, "x"); wrote = "yes"; } catch {}
let net = "no"; try { await fetch("https://example.com"); net = "yes"; } catch {}
console.log(JSON.stringify({ wrote, net, key: process.env.ANTHROPIC_API_KEY ?? null }));
writeFileSync("local.txt", "ok");`,
  });
  process.env.ANTHROPIC_API_KEY ??= "sk-ant-test-only";
  const r = runSandboxed(dir, ["probe.mjs"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { wrote: "no", net: "no", key: null });
  assert.equal(existsSync(join(repo, "PWNED")), false);
  assert.equal(existsSync(join(dir, "local.txt")), false, "la copie est jetée, l'original intact");
});

test("sandbox : aucun socket Unix de l'hôte n'est joignable (Docker compris)", { skip: !SANDBOX && "bubblewrap absent" }, async () => {
  const { createServer } = await import("node:net");
  const sockDir = mkdtempSync(join(tmpdir(), "ff-sock-"));
  const sock = join(sockDir, "host.sock");
  let got = false;
  const server = createServer((c) => c.on("data", () => (got = true)));
  await new Promise((r) => server.listen(sock, r));
  const dir = app({
    "probe.mjs": `import { connect } from "node:net"; import { existsSync } from "node:fs";
const seen = [${JSON.stringify(sock)}, "/var/run/docker.sock", "/run/docker.sock", "/home"].filter((p) => existsSync(p));
const c = connect(${JSON.stringify(sock)}); c.on("error", () => { console.log(JSON.stringify({ seen, connected: false })); });
c.on("connect", () => { c.write("x"); console.log(JSON.stringify({ seen, connected: true })); c.end(); });`,
  });
  const { spawn } = await import("node:child_process");
  // runSandboxed est synchrone : on le lance dans un autre processus pour garder le serveur actif.
  const child = spawn(process.execPath, ["-e", `import(${JSON.stringify(join(repo, "scripts/lib/sandbox.mjs"))}).then(m => process.stdout.write(m.runSandboxed(${JSON.stringify(dir)}, ["probe.mjs"]).stdout))`]);
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  await new Promise((r) => child.on("close", r));
  server.close();
  assert.deepEqual(JSON.parse(stdout), { seen: [], connected: false });
  assert.equal(got, false);
});

test("API réseau, balise base et politique de sécurité propre refusées", () => {
  for (const js of ["new WebSocket('wss://x')", "navigator.sendBeacon('/x')", "new RTCPeerConnection()", "new EventSource('/s')"]) {
    assert.ok(checkSite(app({ "app.js": (j) => j + "\n" + js }), PUBLISHED).includes("API réseau interdite dans app.js"), js);
  }
  const csp = app({ "index.html": (h) => h.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="default-src *">`) });
  assert.ok(checkSite(csp, PUBLISHED).some((p) => p.startsWith("politique de sécurité propre interdite")));
  const base = app({ "index.html": (h) => h.replace("<head>", `<head><base href="https://evil.example/">`) });
  assert.ok(checkSite(base, PUBLISHED).includes("balise <base> interdite"));
});

test("chaque critère doit être vérifié par test.mjs", { skip: !SANDBOX && "bubblewrap absent" }, () => {
  const spec = JSON.parse(readFileSync(join(FIXTURE, "spec.json"), "utf8"));
  assert.deepEqual(checkAcceptance(app(), spec).problems, []);
  const partial = app({ "test.mjs": 'console.log("ok AC-1")' });
  assert.deepEqual(checkAcceptance(partial, spec).problems, ["critère AC-2 non vérifié par test.mjs"]);
  const failing = app({ "test.mjs": 'console.log("ok AC-1\\nok AC-2"); process.exit(1)' });
  assert.ok(checkAcceptance(failing, spec).problems[0].startsWith("test.mjs échoue"));
});

test("porte complète : verdict écrit, site publiable sans fichiers de travail", { skip: !SANDBOX && "bubblewrap absent" }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), "ff-verdict-")), "v");
  const gate = await runGate(app({ "report.json": '{"status":"ok"}' }), out, repo, { browser: noBrowser });
  assert.equal(gate.passed, true, gate.problems.join("\n"));
  assert.deepEqual(gate.acceptanceSeen.sort(), ["AC-1", "AC-2"]);
  assert.ok(existsSync(join(out, "site", "index.html")));
  for (const f of ["spec.json", "review.json", "report.json"]) assert.equal(existsSync(join(out, "site", f)), false, f);
  const { hasFactoryCsp } = await import("../scripts/lib/harden.mjs");
  assert.ok(hasFactoryCsp(readFileSync(join(out, "site", "index.html"), "utf8")), "la page publiée porte la politique de l'usine");
});

test("porte : sandbox ou navigateur absents = panne, pas un refus de l'app", { skip: !SANDBOX && "bubblewrap absent" }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), "ff-verdict-")), "v");
  const gate = await runGate(app(), out, repo, { browser: async () => ["navigateur indisponible : absent"] });
  assert.equal(gate.passed, false);
  assert.equal(gate.infra, true);
});

test("porte : spec trafiquée ou app refusée → pas de site publiable", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "ff-verdict-")), "v");
  const tampered = app({ "spec.json": (s) => JSON.stringify({ ...JSON.parse(s), extra: "x" }) });
  const gate = await runGate(tampered, out, repo, { browser: noBrowser });
  assert.equal(gate.passed, false);
  assert.ok(gate.problems.includes("spec : champ inattendu : extra"));
  assert.equal(existsSync(join(out, "site")), false);
  const unknown = app({ "spec.json": (s) => JSON.stringify({ ...JSON.parse(s), slug: "inconnue" }) });
  await assert.rejects(runGate(unknown, out, repo, { browser: noBrowser }), /app inconnue/);
});

test("porte : un problème vu par le navigateur bloque", { skip: !SANDBOX && "bubblewrap absent" }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), "ff-verdict-")), "v");
  const gate = await runGate(app(), out, repo, { browser: async () => ["375 px — erreur JS : boom"] });
  assert.equal(gate.passed, false);
  assert.deepEqual(gate.problems, ["375 px — erreur JS : boom"]);
});

let browserReady = false;
try {
  if (process.env.FF_PLAYWRIGHT) await import(process.env.FF_PLAYWRIGHT);
  else await import("playwright");
  browserReady = true;
} catch {}
if (process.env.FF_REQUIRE_ALL && !browserReady) throw new Error("playwright requis en CI");

test("navigateur réel : sous la politique de l'usine, une requête différée est bloquée", { skip: !browserReady && "playwright absent" }, async () => {
  const { browserSmoke } = await import("../scripts/lib/browser-smoke.mjs");
  const { harden } = await import("../scripts/lib/harden.mjs");
  const dir = app({
    "app.js": (j) => j + '\nif (typeof document !== "undefined") setTimeout(() => fetch("https://tracker.example/late").catch(() => {}), 1500);',
  });
  writeFileSync(join(dir, "index.html"), harden(readFileSync(join(dir, "index.html"), "utf8")));
  const problems = await browserSmoke(dir);
  assert.ok(problems.some((p) => p.includes("console") && /Content Security Policy|connect-src/i.test(p)), problems.join("\n"));
  assert.ok(!problems.some((p) => p.includes("requête externe")), "la requête n'est même pas partie");
});

test("navigateur réel : app saine acceptée, requête externe et débordement refusés", { skip: !browserReady && "playwright absent" }, async () => {
  const { browserSmoke } = await import("../scripts/lib/browser-smoke.mjs");
  assert.deepEqual(await browserSmoke(app()), []);
  const bad = app({
    "app.js": (j) => j + '\nif (typeof document !== "undefined") { fetch("https://tracker.example/p").catch(() => {}); document.body.insertAdjacentHTML("beforeend", "<div style=\\"width:2000px\\">x</div>"); }',
  });
  const problems = await browserSmoke(bad);
  assert.ok(problems.some((p) => p.includes("requête externe : https://tracker.example/p")), problems.join("\n"));
  assert.ok(problems.some((p) => p.startsWith("375 px — débordement horizontal")), problems.join("\n"));
});
