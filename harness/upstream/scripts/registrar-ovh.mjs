#!/usr/bin/env node
// registrar-ovh.mjs - OVH's API for the sub-skill that points an OVH domain to Cloudflare
// (_dns-ovh, called by /add-domain). Every call is signed in THIS process, with the three keys
// read from the vault here: none of them ever goes on a command line. Until 3.4.11 the sub-skill
// gave the consumer key to curl as an argument, readable in the list of the machine's processes,
// and signed with `sha1sum`, which macOS does not ship (outside review of 3.4.10).
//
//   node registrar-ovh.mjs check
//        the keys answer: {ok, account}
//   node registrar-ovh.mjs nameservers <domain>
//        the domain's nameservers, as OVH holds them now: {ok, domain, nameServers}
//   node registrar-ovh.mjs set-nameservers <domain> <ns> <ns> [<ns>...]
//        switches the domain to external nameservers, sends the list, then reads it back:
//        {ok, domain, sent, task, nameServers}. OVH applies the change in a task of its own (a
//        few minutes): the list read back may still be the old one.
//
// The keys: the vault's item OVH, fields app_key, app_secret, consumer_key. The API: OVH Europe,
// https://eu.api.ovh.com/1.0, signature "$1$" + sha1(secret+consumer+method+url+body+time), the
// time read from the API itself (/auth/time), as OVH documents it.
//
// Exit codes: 0 done, 1 refused by OVH or an answer that cannot be read, 2 vault locked,
// 3 vault session expired, 4 keys missing from the vault, 5 usage (nothing sent).
// One JSON object on stdout, never a key.
//
// Recettes only: HYPERVIBE_OVH_API, a fake API on the loopback (anything else is ignored); with
// it, and only with it, the keys may come from OVH_APP_KEY, OVH_APP_SECRET and OVH_CONSUMER_KEY,
// since they can then reach nothing but the loopback.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OVH_EU = "https://eu.api.ovh.com/1.0";
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const EXIT = { OK: 0, REFUSED: 1, LOCKED: 2, EXPIRED: 3, NO_KEYS: 4, USAGE: 5 };

/** The API's base: OVH Europe, or a recette's fake on the loopback (never anything else). */
export function apiBase(env = process.env) {
  const override = env.HYPERVIBE_OVH_API;
  return override && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(override) ? `${override}/1.0` : OVH_EU;
}

/** One field of the vault's item OVH: {status, value}, as the vault's tool exits. */
function fromVault(field) {
  const r = spawnSync(process.execPath, [join(HERE, "vault", "vault.mjs"), "get", "OVH", field], { encoding: "utf8", windowsHide: true });
  return { status: r.status, value: String(r.stdout ?? "").trim() };
}

/** The three keys: from the environment only when the API is a recette's loopback, from the
 *  vault otherwise (`vault` reads one field; a recette gives its own). {keys} or {code, error}. */
export function readKeys(env = process.env, base = apiBase(env), vault = fromVault) {
  if (base !== OVH_EU) {
    const keys = { app: env.OVH_APP_KEY, secret: env.OVH_APP_SECRET, consumer: env.OVH_CONSUMER_KEY };
    return keys.app && keys.secret && keys.consumer ? { keys } : { code: EXIT.NO_KEYS, error: "The OVH keys are missing." };
  }
  const keys = {};
  for (const [name, field] of [["app", "app_key"], ["secret", "app_secret"], ["consumer", "consumer_key"]]) {
    const r = vault(field);
    if (r.status === 2) return { code: EXIT.LOCKED, error: "The vault is locked: open it, then retry." };
    if (r.status === 3) return { code: EXIT.EXPIRED, error: "The vault session has expired: open the vault again, then retry." };
    const value = String(r.value ?? "").trim();
    if (r.status !== 0 || !value) return { code: EXIT.NO_KEYS, error: "The OVH keys are not in the vault (item OVH: app_key, app_secret, consumer_key)." };
    keys[name] = value;
  }
  return { keys };
}

/** OVH's signature of one call. */
export function signature({ secret, consumer }, method, url, body, time) {
  return `$1$${createHash("sha1").update(`${secret}+${consumer}+${method}+${url}+${body}+${time}`).digest("hex")}`;
}

/** One signed call: {status, json, text}. Throws on a network failure. */
async function call(base, keys, method, path, payload) {
  const url = `${base}${path}`;
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timeRes = await fetch(`${base}/auth/time`, { signal: AbortSignal.timeout(20000) });
  const time = String(await timeRes.text()).trim();
  if (!timeRes.ok || !/^\d+$/.test(time)) throw new Error(`OVH's clock could not be read (${timeRes.status}).`);
  const headers = {
    "X-Ovh-Application": keys.app,
    "X-Ovh-Consumer": keys.consumer,
    "X-Ovh-Timestamp": time,
    "X-Ovh-Signature": signature(keys, method, url, body, time),
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body || undefined, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, text };
}

/** OVH's own words for a refusal, never a key (OVH's messages do not carry them). */
function refusal(step, r) {
  const said = r.json?.message ?? String(r.text ?? "").slice(0, 300);
  return { ok: false, step, status: r.status, error: said || `HTTP ${r.status}` };
}

/** The domain's nameservers as OVH holds them: {ok, nameServers} or a refusal. */
async function readNameServers(base, keys, domain) {
  const ids = await call(base, keys, "GET", `/domain/${domain}/nameServer`);
  if (ids.status !== 200 || !Array.isArray(ids.json)) return refusal("read", ids);
  const nameServers = [];
  for (const id of ids.json) {
    const one = await call(base, keys, "GET", `/domain/${domain}/nameServer/${encodeURIComponent(id)}`);
    if (one.status !== 200 || typeof one.json?.host !== "string") return refusal("read", one);
    nameServers.push(one.json.host);
  }
  return { ok: true, nameServers };
}

async function main(argv, env = process.env) {
  const [verb, domain, ...servers] = argv;
  const usage = (error) => ({ code: EXIT.USAGE, out: { ok: false, error } });
  if (!["check", "nameservers", "set-nameservers"].includes(verb)) return usage("Usage: registrar-ovh.mjs check | nameservers <domain> | set-nameservers <domain> <ns> <ns> [...]");
  if (verb !== "check" && !DOMAIN.test(String(domain ?? ""))) return usage(`Not a domain name: "${domain ?? ""}" (lower case, without www. or https://).`);
  if (verb === "set-nameservers") {
    if (servers.length < 2) return usage("Give at least two nameservers: an empty or single one would take the domain offline.");
    const bad = servers.find((s) => !DOMAIN.test(s));
    if (bad !== undefined) return usage(`Not a nameserver: "${bad}". Nothing was sent.`);
  }
  const base = apiBase(env);
  const read = readKeys(env, base);
  if (!read.keys) return { code: read.code, out: { ok: false, error: read.error } };
  const { keys } = read;
  try {
    if (verb === "check") {
      const me = await call(base, keys, "GET", "/me");
      if (me.status !== 200) return { code: EXIT.REFUSED, out: refusal("check", me) };
      return { code: EXIT.OK, out: { ok: true, account: me.json?.nichandle ?? null } };
    }
    if (verb === "nameservers") {
      const now = await readNameServers(base, keys, domain);
      return now.ok ? { code: EXIT.OK, out: { ok: true, domain, nameServers: now.nameServers } } : { code: EXIT.REFUSED, out: now };
    }
    // set-nameservers: OVH refuses a new list while the domain is on its own ("hosted")
    // nameservers, hence the switch to "external" first, then the list.
    const external = await call(base, keys, "PUT", `/domain/${domain}`, { nameServerType: "external" });
    if (external.status !== 200) return { code: EXIT.REFUSED, out: refusal("external", external) };
    const update = await call(base, keys, "POST", `/domain/${domain}/nameServers/update`, { nameServers: servers.map((host) => ({ host })) });
    if (update.status !== 200) return { code: EXIT.REFUSED, out: refusal("update", update) };
    const task = update.json && typeof update.json === "object" ? { id: update.json.id ?? null, status: update.json.status ?? null } : null;
    const now = await readNameServers(base, keys, domain);
    return { code: EXIT.OK, out: { ok: true, domain, sent: servers, task, nameServers: now.ok ? now.nameServers : null } };
  } catch (e) {
    return { code: EXIT.REFUSED, out: { ok: false, error: `OVH could not be reached: ${e.message}` } };
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
