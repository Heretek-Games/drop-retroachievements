import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import Plugin, { parseGameSummary } from "../src/index.js";

test("drop-retroachievements registers its route", async () => {
  const ctx = new MockPluginContext("drop-retroachievements", ["routes", "storage", "network", "events"]);
  await new Plugin().init(ctx);
  assert.ok(ctx.routes.size >= 1);
});

test("parseGameSummary reads the achievement set", () => {
  const set = parseGameSummary({ ID: 123, Title: "Chrono Trigger", NumAchievements: 45 });
  assert.deepEqual(set, { gameId: 123, title: "Chrono Trigger", achievementCount: 45 });
  assert.equal(parseGameSummary({}), null);
});
