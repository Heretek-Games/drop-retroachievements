import type { PluginContext, ServerPlugin } from "@droposs/plugin-sdk";
import { newlyUnlocked, parseAchievements } from "./achievements.js";

export * from "./achievements.js";

const API_BASE = "https://retroachievements.org/API";

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
  if (!body.ID && !body.Title) return null;
  return {
    gameId: Number(body.ID ?? 0),
    title: String(body.Title ?? "Unknown"),
    achievementCount: Number(body.NumAchievements ?? 0),
  };
}

export default class RetroAchievementsPlugin implements ServerPlugin {
  metadata = {
    id: "drop-retroachievements",
    name: "RetroAchievements Bridge",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: ["routes" as const, "storage" as const, "network" as const, "events" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    ctx.registerRoute("GET", "/games/:hash", async (_event, routeContext) => {
      const username = process.env.RETROACHIEVEMENTS_USER;
      const apiKey = process.env.RETROACHIEVEMENTS_API_KEY;
      if (!username || !apiKey) return { linked: false };
      const url = `${API_BASE}/API_GetGameHashes.php?u=${username}&y=${apiKey}&h=${routeContext.params.hash}`;
      const response = await ctx.fetch(url);
      return { linked: response.ok, hash: routeContext.params.hash };
    });

    // REST: Map a RetroAchievements progress payload to new unlock events
    ctx.registerRoute("POST", "/sync", async (event) => {
      const body = await getRequestBody<{
        progress?: unknown;
        knownAchievements?: string[];
      }>(event);
      const known = new Set(body.knownAchievements ?? []);
      const unlocks = newlyUnlocked(known, parseAchievements(body.progress));
      for (const unlock of unlocks) {
        ctx.broadcast("drop:achievement:unlock", unlock);
      }
      return { unlocks };
    });

    ctx.logger.info("RetroAchievements bridge initialized");
  }
}
