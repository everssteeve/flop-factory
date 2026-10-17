#!/usr/bin/env node
// test-registrar-ovh.mjs - Recette of scripts/registrar-ovh.mjs, the OVH calls of the sub-skill
// that points an OVH domain to Cloudflare (3.4.11): signed in the script's own process, the keys
// never on a command line, never in the output, a nameserver list never empty. Against a fake OVH
// API on the loopback, which checks every signature as OVH does: no network, no vault.
//
//   node scripts/tests/test-registrar-ovh.mjs

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "registrar-ovh.mjs");
const { apiBase, readKeys, signature, EXIT } = await import(pathToFileURL(SCRIPT).href);
const WORK = mkdtempSync(join(tmpdir(), "hv-ovh-"));
const KEYS = { app: "ak-de-recette", secret: "as-de-recette", consumer: "ck-de-recette" };
const TIME = "1791960000";

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 400)})`}`);
}

// ── The fake OVH API ───────────────────────────────────────────────────────────
let state;
const reset = (o = {}) => {
  state = { hosts: ["dns100.ovh.net", "ns100.ovh.net"], external: false, seen: [], refuse: {}, badSignatures: 0, ...o };
};
reset();
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    const path = req.url.replace(/^\/1\.0/, "");
    if (path === "/auth/time") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(TIME);
    }
    const url = `${API}/1.0${path}`;
    const expected = signature(KEYS, req.method, url, raw, req.headers["x-ovh-timestamp"]);
    state.seen.push({ method: req.method, path, body: raw, headers: req.headers });
    if (req.headers["x-ovh-application"] !== KEYS.app || req.headers["x-ovh-consumer"] !== KEYS.consumer || req.headers["x-ovh-signature"] !== expected) {
      state.badSignatures += 1;
      return send(400, { message: "Invalid signature", httpCode: "400 Bad Request", errorCode: "INVALID_SIGNATURE" });
    }
    const refused = state.refuse[`${req.method} ${path}`];
    if (refused) return send(refused.status, { message: refused.message });
    if (req.method === "GET" && path === "/me") return send(200, { nichandle: "aa12345-ovh" });
    const m = /^\/domain\/([^/]+)(\/.*)?$/.exec(path);
    if (!m || m[1] !== "example.fr") return send(404, { message: "This service does not exist" });
    const rest = m[2] ?? "";
    if (req.method === "PUT" && rest === "") {
      state.external = JSON.parse(raw).nameServerType === "external";
      return send(200, null);
    }
    if (req.method === "POST" && rest === "/nameServers/update") {
      if (!state.external) return send(403, { message: "The domain uses OVH's own nameservers" });
      state.hosts = JSON.parse(raw).nameServers.map((n) => n.host);
      return send(200, { id: 4242, status: "todo", function: "DomainDnsUpdate" });
    }
    if (req.method === "GET" && rest === "/nameServer") return send(200, state.hosts.map((_, i) => i + 1));
    const one = /^\/nameServer\/(\d+)$/.exec(rest);
    if (req.method === "GET" && one) return send(200, { id: Number(one[1]), host: state.hosts[Number(one[1]) - 1], isUsed: true });
    return send(404, { message: "Not found" });
  });
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const API = `http://127.0.0.1:${server.address().port}`;

/** The script as the sub-skill runs it, with the fake API and the recette's keys. */
function run(args, env = {}) {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, HYPERVIBE_OVH_API: API, OVH_APP_KEY: KEYS.app, OVH_APP_SECRET: KEYS.secret, OVH_CONSUMER_KEY: KEYS.consumer, ...env },
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      let json = null;
      try {
        json = JSON.parse(out.trim().split("\n").pop());
      } catch {}
      ok({ code, out, err, json });
    });
  });
}
const noKey = (r) => ![KEYS.app, KEYS.secret, KEYS.consumer].some((k) => `${r.out}${r.err}`.includes(k));

try {
  // ── Where the keys come from ────────────────────────────────────────────────────
  check("the API is OVH Europe unless a recette's loopback is named", apiBase({}) === "https://eu.api.ovh.com/1.0" && apiBase({ HYPERVIBE_OVH_API: "https://evil.example" }) === "https://eu.api.ovh.com/1.0" && apiBase({ HYPERVIBE_OVH_API: API }) === `${API}/1.0`);
  {
    // The vault, stood in for: this recette never runs the vault's tool.
    const asked = [];
    const vault = (answers) => (field) => {
      asked.push(field);
      return answers[field] ?? { status: 4, value: "" };
    };
    const envKeys = { OVH_APP_KEY: "a", OVH_APP_SECRET: "b", OVH_CONSUMER_KEY: "c" };
    check("keys from the environment are taken with the loopback API, and the vault is not asked", readKeys({ ...envKeys, HYPERVIBE_OVH_API: API }, undefined, vault({})).keys?.app === "a" && asked.length === 0);
    check("against OVH, the environment's keys are ignored: the vault alone", readKeys(envKeys, "https://eu.api.ovh.com/1.0", vault({})).keys === undefined && asked[0] === "app_key");
    const full = { app_key: { status: 0, value: "va" }, app_secret: { status: 0, value: "vs" }, consumer_key: { status: 0, value: "vc" } };
    check("... and read there, the three fields", JSON.stringify(readKeys({}, "https://eu.api.ovh.com/1.0", vault(full)).keys) === JSON.stringify({ app: "va", secret: "vs", consumer: "vc" }));
    check("a locked vault, an expired one, a missing item: exits 2, 3 and 4", readKeys({}, "https://eu.api.ovh.com/1.0", vault({ app_key: { status: 2 } })).code === EXIT.LOCKED && readKeys({}, "https://eu.api.ovh.com/1.0", vault({ app_key: { status: 3 } })).code === EXIT.EXPIRED && readKeys({}, "https://eu.api.ovh.com/1.0", vault({})).code === EXIT.NO_KEYS);
  }
  check("the signature is OVH's: $1$ and sha1 of secret+consumer+method+url+body+time", signature({ secret: "s", consumer: "c" }, "GET", "https://x/1.0/me", "", "1") === `$1$${createHash("sha1").update("s+c+GET+https://x/1.0/me++1").digest("hex")}`);

  // ── check ─────────────────────────────────────────────────────────────────────────
  reset();
  let r = await run(["check"]);
  check("check: the keys answer, the account is named", r.code === EXIT.OK && r.json?.ok === true && r.json.account === "aa12345-ovh" && state.badSignatures === 0, r.out + r.err);
  check("... no key in what it prints", noKey(r));
  r = await run(["check"], { OVH_APP_SECRET: "un-autre-secret" });
  check("a wrong secret: OVH's refusal said (its signature check), exit 1", r.code === EXIT.REFUSED && r.json?.ok === false && /Invalid signature/.test(r.json.error ?? ""), r.out);
  check("... and still no key printed", noKey(r));

  // ── set-nameservers ──────────────────────────────────────────────────────────────
  reset();
  r = await run(["set-nameservers", "example.fr", "ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]);
  const put = state.seen.find((s) => s.method === "PUT");
  const post = state.seen.find((s) => s.method === "POST");
  check("set-nameservers: the domain switched to external, then the list sent", r.code === EXIT.OK && JSON.parse(put?.body ?? "{}").nameServerType === "external" && JSON.stringify(JSON.parse(post?.body ?? "{}")) === JSON.stringify({ nameServers: [{ host: "ada.ns.cloudflare.com" }, { host: "bob.ns.cloudflare.com" }] }), r.out + r.err);
  check("... every call signed as OVH checks it", state.badSignatures === 0 && state.seen.every((s) => /^\$1\$[0-9a-f]{40}$/.test(s.headers["x-ovh-signature"] ?? "")));
  check("... the switch before the list, never the other way", state.seen.findIndex((s) => s.method === "PUT") < state.seen.findIndex((s) => s.method === "POST"));
  check("... OVH's task and the list read back are said", r.json?.task?.id === 4242 && r.json.task.status === "todo" && JSON.stringify(r.json.nameServers) === JSON.stringify(["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]), r.out);
  check("... no key in what it prints", noKey(r));

  reset({ refuse: { "PUT /domain/example.fr": { status: 403, message: "This call has not been granted" } } });
  r = await run(["set-nameservers", "example.fr", "ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]);
  check("a switch OVH refuses (keys without the right): its words, exit 1, and the list never sent", r.code === EXIT.REFUSED && r.json?.step === "external" && /not been granted/.test(r.json.error ?? "") && !state.seen.some((s) => s.method === "POST"), r.out);

  reset({ refuse: { "POST /domain/example.fr/nameServers/update": { status: 400, message: "Invalid nameserver" } } });
  r = await run(["set-nameservers", "example.fr", "ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]);
  check("a list OVH refuses: said with the step, exit 1", r.code === EXIT.REFUSED && r.json?.step === "update" && /Invalid nameserver/.test(r.json.error ?? ""), r.out);

  // ── What is never sent ────────────────────────────────────────────────────────────
  for (const [label, args] of [
    ["one nameserver only", ["set-nameservers", "example.fr", "ada.ns.cloudflare.com"]],
    ["an empty nameserver (a variable left empty)", ["set-nameservers", "example.fr", "", "bob.ns.cloudflare.com"]],
    ["no nameserver at all", ["set-nameservers", "example.fr"]],
    ["a domain given with www and its scheme", ["set-nameservers", "https://www.example.fr", "ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]],
    ["a domain in capitals", ["nameservers", "Example.FR"]],
    ["a verb it does not know", ["delete", "example.fr"]],
  ]) {
    reset();
    r = await run(args);
    check(`${label}: exit 5, nothing sent to OVH`, r.code === EXIT.USAGE && r.json?.ok === false && state.seen.length === 0, r.out);
  }

  // ── nameservers ───────────────────────────────────────────────────────────────────
  reset();
  r = await run(["nameservers", "example.fr"]);
  check("nameservers: the list OVH holds now, read only", r.code === EXIT.OK && JSON.stringify(r.json?.nameServers) === JSON.stringify(["dns100.ovh.net", "ns100.ovh.net"]) && state.seen.every((s) => s.method === "GET"), r.out);

  // ── The keys missing ──────────────────────────────────────────────────────────────
  reset();
  r = await run(["check"], { OVH_CONSUMER_KEY: "" });
  check("a key missing: exit 4, nothing sent", r.code === EXIT.NO_KEYS && state.seen.length === 0, r.out);
} finally {
  server.close();
  rmSync(WORK, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
