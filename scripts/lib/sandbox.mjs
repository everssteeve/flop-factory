// Exécute du code écrit par un agent (le test.mjs d'une app) hors de portée du
// job qui l'appelle. Le processus ne voit qu'un système minimal en lecture
// seule : les binaires, les bibliothèques et Node. Pas de /run, de /var ni de
// /home, donc aucun socket Unix de l'hôte (Docker compris), pas de réseau,
// environnement vidé, copie jetable du dossier. Sans bubblewrap, on refuse.

import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

/** Montages en lecture seule : le strict nécessaire pour lancer Node. */
export function systemMounts(execPath = process.execPath) {
  const args = [];
  for (const p of ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32"]) {
    if (!existsSync(p)) continue;
    const st = lstatSync(p);
    if (st.isSymbolicLink()) args.push("--symlink", readlinkSync(p), p);
    else args.push("--ro-bind", p, p);
  }
  for (const p of ["/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d", "/etc/alternatives", "/etc/localtime"]) {
    if (existsSync(p)) args.push("--ro-bind", p, p);
  }
  // Dossier d'installation de Node, s'il est hors de /usr (runners GitHub, nvm…).
  const nodeHome = dirname(dirname(realpathSync(execPath)));
  if (!nodeHome.startsWith("/usr/")) args.push("--ro-bind", nodeHome, nodeHome);
  return args;
}

function bwrapArgs(copy) {
  return [
    ...systemMounts(),
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    "--bind", copy, "/tmp/work",
    "--chdir", "/tmp/work",
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
    "--setenv", "HOME", "/tmp/work",
  ];
}

export function sandboxAvailable() {
  const r = spawnSync("bwrap", [...systemMounts(), "--dev", "/dev", "--unshare-all", "--die-with-parent", process.execPath, "-e", "0"], { encoding: "utf8" });
  return r.status === 0;
}

/** `node <args>` dans la sandbox, sur une copie de `dir`. */
export function runSandboxed(dir, args, { timeout = 60_000 } = {}) {
  if (!sandboxAvailable()) return { status: null, stdout: "", stderr: "", error: "sandbox indisponible (bubblewrap)", infra: true };
  const copy = mkdtempSync(join(tmpdir(), "ff-untrusted-"));
  try {
    cpSync(dir, copy, { recursive: true, verbatimSymlinks: true });
    const r = spawnSync("bwrap", [...bwrapArgs(copy), process.execPath, ...args], { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ? String(r.error.code ?? r.error) : null, infra: false };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
