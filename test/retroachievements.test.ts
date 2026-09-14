import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import Plugin, {
  newlyUnlocked,
  parseAchievements,
  parseGameSummary,
} from "../src/index.js";

test("drop-retroachievements registers its routes", async () => {
  const ctx = new MockPluginContext("drop-retroachievements", [
    "routes",
    "storage",
    "network",
    "events",
  ]);
  await new Plugin().init(ctx);
  assert.ok(ctx.routes.size >= 2);
});

test("parseGameSummary reads the achievement set", () => {
  const set = parseGameSummary({
    ID: 123,
    Title: "Chrono Trigger",
    NumAchievements: 45,
  });
  assert.deepEqual(set, {
    gameId: 123,
    title: "Chrono Trigger",
    achievementCount: 45,
  });
  assert.equal(parseGameSummary({}), null);
});

test("parseAchievements handles object-map and array payloads", () => {
  const fromMap = parseAchievements({
    Achievements: {
      "1": { ID: 1, Title: "First", Points: 5, DateEarned: 1700000000 },
      "2": { ID: 2, Title: "Second", Points: 10, DateEarned: 0 },
    },
  });
  assert.equal(fromMap.length, 2);
  assert.equal(fromMap[0].earned, true);
  assert.equal(fromMap[1].earned, false);

  const fromArray = parseAchievements({
    Achievements: [{ ID: 3, Title: "Third", Points: 1, DateEarnedHardcore: 1 }],
  });
  assert.equal(fromArray[0].earnedHardcore, true);
});

test("newlyUnlocked emits only earned, not-yet-known achievements", () => {
  const achievements = parseAchievements({
    Achievements: {
      "1": { ID: 1, Title: "First", Points: 5, DateEarned: 1 },
      "2": { ID: 2, Title: "Second", Points: 10, DateEarned: 0 },
      "3": { ID: 3, Title: "Third", Points: 20, DateEarnedHardcore: 1 },
    },
  });
  const unlocks = newlyUnlocked(new Set(["ra:1"]), achievements);
  assert.deepEqual(
    unlocks.map((unlock) => unlock.key),
    ["ra:3"],
  );
  assert.equal(unlocks[0].hardcore, true);
});
