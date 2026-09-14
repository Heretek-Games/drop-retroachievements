import type { PluginContext, ServerPlugin } from "@droposs/plugin-sdk";
import {
  newlyUnlocked,
  parseAchievements,
} from "./achievements.js";
import {
  type HttpFetch,
  type RaClientOptions,
  RA_CREDENTIALS_KEY,
  fetchGameProgress,
  loadKnownAchievements,
  readCredentials,
  resolveGameId,
  saveKnownAchievements,
} from "./api.js";

export * from "./achievements.js";
export * from "./api.js";

async function getRequestBody<T = Record<string, unknown>>(
  event: unknown,
): Promise<T> {
  const candidate = event as { body?: unknown } | undefined;
  if (candidate && candidate.body !== undefined) {
    return candidate.body as T;
  }
  try {
    // @ts-expect-error optional h3 dependency at runtime
    const h3 = await import("h3").catch(() => null);
    if (h3?.readBody) {
      return ((await h3.readBody(event)) ?? {}) as T;
    }
  } catch {
    // fall through to an empty body
  }
  return {} as T;
}

export interface AchievementSet {
  gameId: number;
  title: string;
  achievementCount: number;
}

/** Extracts the achievement-set summary from a RetroAchievements API payload. */
export function parseGameSummary(payload: unknown): AchievementSet | null {
  const body = (payload ?? {}) as Record<string, unknown>;
  const id = body.ID ?? body.id;
  const title = body.Title ?? body.title;
  if (!id && !title) return null;
  return {
    gameId: Number(id ?? 0),
    title: String(title ?? "Unknown"),
    achievementCount: Number(
      body.NumAchievements ?? body.numAchievements ?? 0,
    ),
  };
}

interface SyncBody {
  gameId?: number | string;
  hash?: string;
  progress?: unknown;
  knownAchievements?: string[];
}

export interface RetroAchievementsPluginOptions {
  /** Network fetch override; defaults to the plugin context fetch. */
  fetchFn?: HttpFetch;
  /** Environment used for the credential fallback. */
  env?: NodeJS.ProcessEnv;
}

export default class RetroAchievementsPlugin implements ServerPlugin {
  metadata = {
    id: "drop-retroachievements",
    name: "RetroAchievements Bridge",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: ["routes" as const, "storage" as const, "network" as const, "events" as const],
  };

  constructor(private readonly options: RetroAchievementsPluginOptions = {}) {}

  async init(ctx: PluginContext): Promise<void> {
    const fetchFn: HttpFetch =
      this.options.fetchFn ?? (ctx.fetch.bind(ctx) as HttpFetch);
    const env = this.options.env ?? process.env;

    ctx.registerRoute("GET", "/config", async () => {
      const credentials = await readCredentials(ctx.storage, env);
      return { configured: credentials !== null, username: credentials?.username };
    });

    ctx.registerRoute("POST", "/config", async (event) => {
      const body = await getRequestBody<{ username?: unknown; apiKey?: unknown }>(
        event,
      );
      const username = String(body.username ?? "").trim();
      const apiKey = String(body.apiKey ?? "").trim();
      if (!username || !apiKey) {
        throw new Error("RetroAchievements config requires username and apiKey");
      }
      await ctx.storage.set(RA_CREDENTIALS_KEY, { username, apiKey });
      ctx.logger.info(`RetroAchievements credentials stored for ${username}`);
      return { configured: true, username };
    });

    // Resolve the ROM hash and return the user's live progress summary.
    ctx.registerRoute("GET", "/games/:hash", async (_event, routeContext) => {
      const credentials = await readCredentials(ctx.storage, env);
      const hash = String(routeContext.params.hash ?? "");
      if (!credentials) return { linked: false, hash };
      const client: RaClientOptions = { fetchFn, credentials };
      const gameId = await resolveGameId(client, hash);
      if (!gameId) return { linked: false, hash };
      const progress = await fetchGameProgress(client, gameId);
      return {
        linked: true,
        hash,
        gameId: progress.gameId,
        title: progress.title,
        total: progress.total,
        earned: progress.earned,
      };
    });

    // Fetch live progress, persist known unlocks, and emit only new events.
    ctx.registerRoute("POST", "/sync", async (event) => {
      const body = await getRequestBody<SyncBody>(event);
      const credentials = await readCredentials(ctx.storage, env);

      if (body.progress === undefined) {
        if (!credentials) {
          throw new Error(
            "RetroAchievements is not configured; POST /config first",
          );
        }
        const client: RaClientOptions = { fetchFn, credentials };
        const requestedId = Number(body.gameId ?? 0);
        const gameId =
          Number.isFinite(requestedId) && requestedId > 0
            ? requestedId
            : body.hash
              ? await resolveGameId(client, body.hash)
              : null;
        if (!gameId) {
          throw new Error(
            "sync requires a numeric gameId or a hash that resolves to a game",
          );
        }
        const progress = await fetchGameProgress(client, gameId);
        const known = await loadKnownAchievements(
          ctx.storage,
          credentials.username,
          progress.gameId,
        );
        const unlocks = newlyUnlocked(known, progress.achievements);
        await saveKnownAchievements(
          ctx.storage,
          credentials.username,
          progress.gameId,
          unlocks.map((unlock) => unlock.key),
        );
        for (const unlock of unlocks) {
          ctx.broadcast("drop:achievement:unlock", unlock);
        }
        return {
          gameId: progress.gameId,
          title: progress.title,
          total: progress.total,
          earned: progress.earned,
          unlocks,
        };
      }

      // Backward-compatible manual payload path.
      const known = new Set(body.knownAchievements ?? []);
      const achievements = parseAchievements(body.progress);
      const unlocks = newlyUnlocked(known, achievements);
      const gameId = Number(body.gameId ?? 0);
      if (credentials && Number.isFinite(gameId) && gameId > 0) {
        await saveKnownAchievements(
          ctx.storage,
          credentials.username,
          gameId,
          unlocks.map((unlock) => unlock.key),
        );
      }
      for (const unlock of unlocks) {
        ctx.broadcast("drop:achievement:unlock", unlock);
      }
      return { unlocks };
    });

    ctx.logger.info("RetroAchievements bridge initialized");
  }
}
