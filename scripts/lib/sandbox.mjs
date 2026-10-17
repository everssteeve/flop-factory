// Exécute du code écrit par un agent (le test.mjs d'une app) hors de portée du
// job qui l'appelle : copie du dossier, système en lecture seule, aucun réseau,
// environnement vidé. Sans bubblewrap, on refuse plutôt que de l'exécuter à nu.

import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function sandboxAvailable() {
  const r = spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-all", "--die-with-parent", "true"], { encoding: "utf8" });
  return r.status === 0;
}

export function runSandboxed(dir, cmd, args, { timeout = 60_000 } = {}) {
  if (!sandboxAvailable()) return { status: null, stdout: "", stderr: "", error: "sandbox indisponible (bubblewrap)" };
  const copy = mkdtempSync(join(tmpdir(), "ff-untrusted-"));
  try {
    cpSync(dir, copy, { recursive: true, verbatimSymlinks: true });
    const r = spawnSync(
      "bwrap",
      [
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--tmpfs", "/home",
        "--tmpfs", "/root",
        "--bind", copy, "/tmp/work",
        "--chdir", "/tmp/work",
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--clearenv",
        "--setenv", "PATH", process.env.PATH ?? "/usr/bin:/bin",
        "--setenv", "HOME", "/tmp/work",
        cmd,
        ...args,
      ],
      { encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 },
    );
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ? String(r.error.code ?? r.error) : null };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
