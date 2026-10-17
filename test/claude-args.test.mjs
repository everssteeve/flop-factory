import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginLoaded, unexpectedPlugins, PLUGIN_NAME } from "../scripts/lib/claude-args.mjs";

const init = (...names) => ({ plugins: names.map((name) => ({ name })), plugin_errors: [] });

test("notre plugin seul est accepté", () => {
  assert.equal(pluginLoaded(init(PLUGIN_NAME)), true);
});

test("les plugins intégrés cc-plugin-* sont tolérés", () => {
  assert.equal(pluginLoaded(init(PLUGIN_NAME, "cc-plugin-telemetry", "cc-plugin-agents-md")), true);
});

test("un plugin inconnu rend le run non gardé", () => {
  const i = init(PLUGIN_NAME, "evil-plugin");
  assert.deepEqual(unexpectedPlugins(i), ["evil-plugin"]);
  assert.equal(pluginLoaded(i), false);
});

test("sans notre plugin, ou avec une erreur, ou sans init : refusé", () => {
  assert.equal(pluginLoaded(init("cc-plugin-telemetry")), false);
  assert.equal(pluginLoaded({ ...init(PLUGIN_NAME), plugin_errors: ["x"] }), false);
  assert.equal(pluginLoaded(null), false);
});
