import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciDecide, factoryVerdict } from "../harness/overlay/hooks/ci-guard.mjs";
import { decide } from "../harness/upstream/hooks/rules.mjs";

const repo = join(import.meta.dirname, "..");
const guard = (cmd) => ciDecide(cmd, decide);

test("une confirmation amont devient un refus", () => {
  for (const cmd of ["git push", "git push origin main", "vercel --prod", "pnpm db:push", "git reset --hard"]) {
    assert.equal(guard(cmd)?.decision, "deny", cmd);
  }
});

test("les refus amont restent des refus", () => {
  assert.equal(guard("git add -A")?.decision, "deny");
  assert.equal(guard("git commit -a -m x")?.decision, "deny");
});

test("les commandes ordinaires passent", () => {
  for (const cmd of ["ls -la", "node test.mjs", "git add index.html", "git status", "pnpm install", "cat README.md", "git push --dry-run"]) {
    assert.equal(guard(cmd), null, cmd);
  }
});

test("règles de l'usine", () => {
  const denied = {
    "live-keys": "curl -u sk_live_abc123: https://api.stripe.com/v1/charges",
    "repo-delete": "gh repo delete everssteeve/app --yes",
    "vercel-remove": "vercel remove my-app --yes",
    "domain-buy": "vercel domains buy flop.fr",
    "neon-delete": "neonctl projects delete abc",
    "secret-read": "echo $ANTHROPIC_API_KEY",
  };
  for (const [rule, cmd] of Object.entries(denied)) {
    assert.equal(factoryVerdict(cmd)?.rule, rule, cmd);
  }
  for (const cmd of ["printenv", "env", "env | grep KEY", "node -e 'console.log(process.env.VERCEL_TOKEN)'", "echo ${GITHUB_TOKEN}"]) {
    assert.equal(factoryVerdict(cmd)?.rule, "secret-read", cmd);
  }
  for (const cmd of ["env NODE_ENV=test node test.mjs", "echo sk_test_123", "gh repo view", "vercel deploy"]) {
    assert.equal(factoryVerdict(cmd), null, cmd);
  }
});

function runHook(dir, stdin) {
  return spawnSync("node", [join(dir, "ci-guard.mjs")], { input: stdin, encoding: "utf8" });
}

test("le hook répond au contrat Claude Code", () => {
  const dir = mkdtempSync(join(tmpdir(), "ff-guard-"));
  cpSync(join(repo, "harness", "overlay", "hooks", "ci-guard.mjs"), join(dir, "ci-guard.mjs"));
  cpSync(join(repo, "harness", "upstream", "hooks", "rules.mjs"), join(dir, "rules.mjs"));
  const deny = runHook(dir, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push" } }));
  const out = JSON.parse(deny.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.permissionDecision, "deny");
  assert.match(out.permissionDecisionReason, /^\[Flop Factory\]/);
  assert.equal(runHook(dir, JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } })).stdout, "");
  assert.equal(runHook(dir, JSON.stringify({ tool_name: "Read", tool_input: { file_path: "x" } })).stdout, "");
});

test("le hook est fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "ff-guard-"));
  cpSync(join(repo, "harness", "overlay", "hooks", "ci-guard.mjs"), join(dir, "ci-guard.mjs"));
  // règles absentes
  const noRules = JSON.parse(runHook(dir, JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } })).stdout);
  assert.equal(noRules.hookSpecificOutput.permissionDecision, "deny");
  // entrée illisible
  writeFileSync(join(dir, "rules.mjs"), "export const decide = () => null;\n");
  const garbled = JSON.parse(runHook(dir, "pas du json").stdout);
  assert.equal(garbled.hookSpecificOutput.permissionDecision, "deny");
  const noCommand = JSON.parse(runHook(dir, JSON.stringify({ tool_name: "Bash", tool_input: {} })).stdout);
  assert.equal(noCommand.hookSpecificOutput.permissionDecision, "deny");
});

import { writeVerdict } from "../harness/overlay/hooks/ci-guard.mjs";
import { mkdirSync, symlinkSync } from "node:fs";

test("les écritures restent dans le dossier de travail, liens compris", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ff-cwd-"));
  assert.equal(writeVerdict({ file_path: "index.html" }, cwd), null);
  assert.equal(writeVerdict({ file_path: join(cwd, "a", "b.css") }, cwd), null);
  assert.equal(writeVerdict({ file_path: "../../.git/hooks/pre-commit" }, cwd)?.rule, "write-outside");
  assert.equal(writeVerdict({ file_path: "/etc/passwd" }, cwd)?.rule, "write-outside");
  const outside = mkdtempSync(join(tmpdir(), "ff-out-"));
  symlinkSync(outside, join(cwd, "lien"));
  assert.equal(writeVerdict({ file_path: "lien/x.js" }, cwd)?.rule, "write-outside");
  assert.equal(writeVerdict({}, cwd)?.rule, "write-unknown");
  assert.equal(writeVerdict({ file_path: "x" }, undefined)?.rule, "write-unknown");
});

test("lecture d'environnement et agents imbriqués refusés", () => {
  for (const cmd of ["cat /proc/self/environ", "tr '\\0' '\\n' < /proc/1/environ", "python3 -c 'import os;print(os.environ)'"]) {
    assert.equal(factoryVerdict(cmd)?.rule, "environ-dump", cmd);
  }
  for (const cmd of ["claude -p hello", "npx claude --version", "curl https://api.anthropic.com/v1/messages", "/opt/bin/claude -p x"]) {
    assert.equal(factoryVerdict(cmd)?.rule, "nested-agent", cmd);
  }
  for (const cmd of ["ls ~/.claude/", "cat claude-notes.md", "mkdir claude_dir"]) {
    assert.equal(factoryVerdict(cmd), null, cmd);
  }
});

test("le hook borne aussi Write et Edit", () => {
  const dir = mkdtempSync(join(tmpdir(), "ff-guard-"));
  cpSync(join(repo, "harness", "overlay", "hooks", "ci-guard.mjs"), join(dir, "ci-guard.mjs"));
  cpSync(join(repo, "harness", "upstream", "hooks", "rules.mjs"), join(dir, "rules.mjs"));
  const cwd = mkdtempSync(join(tmpdir(), "ff-cwd-"));
  const deny = runHook(dir, JSON.stringify({ tool_name: "Write", cwd, tool_input: { file_path: "../evil.mjs", content: "x" } }));
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runHook(dir, JSON.stringify({ tool_name: "Edit", cwd, tool_input: { file_path: "index.html" } })).stdout, "");
});
