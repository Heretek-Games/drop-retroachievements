import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import type { RouteHandlerContext } from "@droposs/plugin-sdk";
import Plugin, {
  type HttpFetch,
  RA_USER_AGENT,
  fetchGameProgress,
  newlyUnlocked,
  parseAchievements,
  parseEarned,
  parseGameSummary,
  parseGameProgress,
  parseResolvedGameId,
  resolveGameId,
} from "../src/index.js";

const CAPABILITIES = ["routes", "storage", "network", "events"] as const;

const PROGRESS = {
  ID: 123,
  Title: "Chrono Trigger",
  NumAchievements: 3,
  Achievements: {
    "1": { ID: 1, Title: "First", Points: 5, DateEarned: 1700000000 },
    "2": { ID: 2, Title: "Second", Points: 10, DateEarned: 0 },
    "3": { ID: 3, Title: "Third", Points: 20, DateEarnedHardcore: 1 },
  },
};

function routeOf(ctx: MockPluginContext, method: string, pattern: string) {
  const route = ctx.routes.get(`${method} ${pattern}`);
  assert.ok(route, `expected route ${method} ${pattern}`);
  return route.handler;
}

const emptyContext: RouteHandlerContext = { params: {}, query: {} };

function paramsContext(hash: string): RouteHandlerContext {
  return { params: { hash }, query: {} };
}

function stubFetch(
  routes: Array<[fragment: string, payload: unknown]>,
  log: string[] = [],
): HttpFetch {
  return async (input) => {
    const url = String(input);
    log.push(url);
    const match = routes.find(([fragment]) => url.includes(fragment));
    if (!match) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => match[1],
    } as unknown as Response;
  };
}

function captureLogs(ctx: MockPluginContext): string[] {
  const logs: string[] = [];
  const capture = (message: string, ...args: unknown[]) => {
    logs.push(`${message} ${args.map(String).join(" ")}`);
  };
  ctx.logger.info = capture;
  ctx.logger.warn = capture;
  ctx.logger.error = capture;
  ctx.logger.debug = capture;
  return logs;
}

test("drop-retroachievements registers its routes", async () => {
  const ctx = new MockPluginContext("drop-retroachievements", [
    ...CAPABILITIES,
  ]);
  await new Plugin().init(ctx);
  assert.ok(ctx.routes.has("GET /config"));
  assert.ok(ctx.routes.has("POST /config"));
  assert.ok(ctx.routes.has("GET /games/:hash"));
  assert.ok(ctx.routes.has("POST /sync"));
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

test("parseAchievements handles object-map, array, and lowercase payloads", () => {
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

  const lowercase = parseAchievements({
    achievements: {
      "9": {
        id: 9,
        title: "Lower",
        points: 7,
        dateEarned: "2016-03-12 17:47:29",
      },
    },
  });
  assert.equal(lowercase[0].id, 9);
  assert.equal(lowercase[0].earned, true);
});

test("parseEarned understands numbers, strings, and zeros", () => {
  assert.equal(parseEarned(0), false);
  assert.equal(parseEarned("0"), false);
  assert.equal(parseEarned(null), false);
  assert.equal(parseEarned(1), true);
  assert.equal(parseEarned("1700000000"), true);
  assert.equal(parseEarned("2016-03-12 17:47:29"), true);
  assert.equal(parseEarned("not a date"), false);
});

test("parseResolvedGameId and parseGameProgress handle API payloads", () => {
  assert.equal(parseResolvedGameId({ Success: true, GameID: 1446 }), 1446);
  assert.equal(parseResolvedGameId({ Success: false, Error: "not found" }), null);
  assert.equal(parseResolvedGameId({}), null);

  const progress = parseGameProgress(PROGRESS);
  assert.equal(progress.gameId, 123);
  assert.equal(progress.title, "Chrono Trigger");
  assert.equal(progress.total, 3);
  assert.equal(progress.earned, 2);
});

test("newlyUnlocked emits only earned, not-yet-known achievements", () => {
  const achievements = parseAchievements(PROGRESS);
  const unlocks = newlyUnlocked(new Set(["ra:1"]), achievements);
  assert.deepEqual(
    unlocks.map((unlock) => unlock.key),
    ["ra:3"],
  );
  assert.equal(unlocks[0].hardcore, true);
});

test("GET /games/:hash returns live progress for configured users", async () => {
  const requests: string[] = [];
  const fetchFn = stubFetch(
    [
      ["dorequest.php", { Success: true, GameID: 123 }],
      ["API_GetGameInfoAndUserProgress.php", PROGRESS],
    ],
    requests,
  );
  const ctx = new MockPluginContext("drop-retroachievements", [
    ...CAPABILITIES,
  ]);
  const plugin = new Plugin({ fetchFn, env: {} });
  await plugin.init(ctx);
  await routeOf(ctx, "POST", "/config")(
    { body: { username: "alice", apiKey: "secret-key" } },
    emptyContext,
  );

  const result = await routeOf(ctx, "GET", "/games/:hash")(
    {},
    paramsContext("abc123def456"),
  );
  assert.deepEqual(result, {
    linked: true,
    hash: "abc123def456",
    gameId: 123,
    title: "Chrono Trigger",
    total: 3,
    earned: 2,
  });
  assert.ok(requests[0].includes("r=gameid&m=abc123def456"));
  assert.ok(requests[1].includes("g=123"));
  assert.ok(requests[1].includes("u=alice"));
  assert.ok(requests[1].includes("y=secret-key"));
});

test("POST /sync emits and persists only newly unlocked achievements", async () => {
  const fetchFn = stubFetch([
    ["API_GetGameInfoAndUserProgress.php", PROGRESS],
  ]);
  const ctx = new MockPluginContext("drop-retroachievements", [
    ...CAPABILITIES,
  ]);
  const broadcasts: unknown[] = [];
  ctx.subscribe("drop:achievement:unlock", (event) => broadcasts.push(event));
  const plugin = new Plugin({ fetchFn, env: {} });
  await plugin.init(ctx);
  await ctx.storage.set("ra_credentials", {
    username: "alice",
    apiKey: "secret-key",
  });

  const first = (await routeOf(ctx, "POST", "/sync")(
    { body: { gameId: 123 } },
    emptyContext,
  )) as { unlocks: Array<{ key: string }>; earned: number };
  assert.deepEqual(
    first.unlocks.map((unlock) => unlock.key),
    ["ra:1", "ra:3"],
  );
  assert.equal(first.earned, 2);
  assert.equal(broadcasts.length, 2);

  const stored = await ctx.storage.get<string[]>("known:alice:123");
  assert.deepEqual(stored, ["ra:1", "ra:3"]);

  const second = (await routeOf(ctx, "POST", "/sync")(
    { body: { gameId: 123 } },
    emptyContext,
  )) as { unlocks: unknown[] };
  assert.deepEqual(second.unlocks, []);
  assert.equal(broadcasts.length, 2);
});

test("POST /sync resolves a hash before fetching progress", async () => {
  const requests: string[] = [];
  const fetchFn = stubFetch(
    [
      ["dorequest.php", { Success: true, GameID: 77 }],
      ["API_GetGameInfoAndUserProgress.php", { ...PROGRESS, ID: 77 }],
    ],
    requests,
  );
  const ctx = new MockPluginContext("drop-retroachievements", [
    ...CAPABILITIES,
  ]);
  const plugin = new Plugin({ fetchFn, env: {} });
  await plugin.init(ctx);
  await ctx.storage.set("ra_credentials", {
    username: "alice",
    apiKey: "secret-key",
  });

  const result = (await routeOf(ctx, "POST", "/sync")(
    { body: { hash: "deadbeef" } },
    emptyContext,
  )) as { gameId: number; unlocks: unknown[] };
  assert.equal(result.gameId, 77);
  assert.equal(result.unlocks.length, 2);
});

test("POST /sync fails closed when unconfigured and keeps the manual payload path", async () => {
  const ctx = new MockPluginContext("drop-retroachievements", [
    ...CAPABILITIES,
  ]);
  await new Plugin({ fetchFn: stubFetch([]), env: {} }).init(ctx);

  await assert.rejects(
    async () =>
      routeOf(ctx, "POST", "/sync")({ body: { gameId: 1 } }, emptyContext),
    /not configured/,
  );

  const manual = (await routeOf(ctx, "POST", "/sync")(
    {
      body: {
        gameId: 123,
        knownAchievements: ["ra:1"],
        progress: PROGRESS,
      },
    },
    emptyContext,
  )) as { unlocks: Array<{ key: string }> };
  assert.deepEqual(manual.unlocks.map((unlock) => unlock.key), ["ra:3"]);
});

test("POST /config stores credentials and never logs the API key", async () => {
  const ctx = new MockPluginContext("drop-retroachievements", [
    ...CAPABILITIES,
  ]);
  const logs = captureLogs(ctx);
  await new Plugin({ fetchFn: stubFetch([]), env: {} }).init(ctx);

  const result = await routeOf(ctx, "POST", "/config")(
    { body: { username: "alice", apiKey: "super-secret" } },
    emptyContext,
  );
  assert.deepEqual(result, { configured: true, username: "alice" });
  assert.ok(!logs.join("\n").includes("super-secret"));

  const publicConfig = await routeOf(ctx, "GET", "/config")({}, emptyContext);
  assert.deepEqual(publicConfig, { configured: true, username: "alice" });
  assert.ok(!JSON.stringify(publicConfig).includes("super-secret"));

  await assert.rejects(
    async () =>
      routeOf(ctx, "POST", "/config")({ body: { username: "a" } }, emptyContext),
    /requires username and apiKey/,
  );
});

test("credentials fall back to the environment when storage is empty", async () => {
  const ctx = new MockPluginContext("drop-retroachievements", [
    ...CAPABILITIES,
  ]);
  const plugin = new Plugin({
    fetchFn: stubFetch([]),
    env: {
      RETROACHIEVEMENTS_USER: "bob",
      RETROACHIEVEMENTS_API_KEY: "env-key",
    },
  });
  await plugin.init(ctx);
  const config = await routeOf(ctx, "GET", "/config")({}, emptyContext);
  assert.deepEqual(config, { configured: true, username: "bob" });
});

test("resolveGameId sends the required User-Agent header", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn: HttpFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ Success: true, GameID: 42 }), {
      status: 200,
    });
  };

  const gameId = await resolveGameId({ fetchFn }, "abc123");
  assert.equal(gameId, 42);
  assert.equal(
    new Headers(calls[0].init?.headers).get("user-agent"),
    RA_USER_AGENT,
  );
});

test("fetchGameProgress sends the required User-Agent header", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn: HttpFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(PROGRESS), { status: 200 });
  };

  await fetchGameProgress(
    { fetchFn, credentials: { username: "alice", apiKey: "secret-key" } },
    123,
  );

  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes("API_GetGameInfoAndUserProgress.php"));
  assert.equal(
    new Headers(calls[0].init?.headers).get("user-agent"),
    RA_USER_AGENT,
  );
});
