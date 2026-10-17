import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSite, scanSecrets } from "../scripts/quality-gate.mjs";

const gate = join(import.meta.dirname, "..", "scripts", "quality-gate.mjs");
const GOOD_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Flop Factory</title><link rel="stylesheet" href="style.css"></head><body><h1>Flop Factory</h1></body></html>`;

function site({ html = GOOD_HTML, test = "process.exit(0)", report = { status: "ok" }, extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ff-gate-"));
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "style.css"), "body{font-family:system-ui}");
  writeFileSync(join(dir, "test.mjs"), test);
  writeFileSync(join(dir, "report.json"), JSON.stringify(report));
  for (const [f, c] of Object.entries(extra)) writeFileSync(join(dir, f), c);
  return dir;
}

const run = (dir) => spawnSync("node", [gate, dir], { encoding: "utf8" });

test("un site conforme passe la porte", () => {
  assert.equal(run(site()).status, 0);
});

test("la porte ne croit pas le rapport de l'agent", () => {
  assert.equal(run(site({ report: { status: "failed" } })).status, 1);
  assert.equal(run(site({ test: "process.exit(1)" })).status, 1);
});

test("contrôles du site", () => {
  assert.deepEqual(checkSite(site()), []);
  assert.ok(checkSite(site({ html: GOOD_HTML.replace(/<title>.*<\/title>/, "") })).includes("pas de <title>"));
  assert.ok(checkSite(site({ html: GOOD_HTML.replace("</body>", '<a href="http://localhost:3000">x</a></body>') })).includes("lien localhost dans la page"));
  assert.ok(checkSite(site({ html: GOOD_HTML.replace("</body>", '<script src="https://evil.example/x.js"></script></body>') })).includes("script externe interdit"));
});

test("un secret commité bloque la publication", () => {
  const dir = site({ extra: { "config.js": "const k = 'sk-ant-api03-abcdefghijklmnop';" } });
  assert.equal(scanSecrets(dir)[0].pattern, "anthropic");
  assert.equal(run(dir).status, 1);
});

test("le test de l'agent tourne sans les secrets du runner", () => {
  const dir = site({ test: "process.exit(process.env.ANTHROPIC_API_KEY ? 1 : 0)" });
  const r = spawnSync("node", [gate, dir], { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-x" } });
  assert.equal(r.status, 0);
});
