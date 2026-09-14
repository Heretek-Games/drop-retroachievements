import type { PluginContext, ServerPlugin } from "@droposs/plugin-sdk";

const API_BASE = "https://retroachievements.org/API";

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

    ctx.logger.info("RetroAchievements bridge initialized");
  }
}
