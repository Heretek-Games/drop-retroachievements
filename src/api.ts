import type { PluginStorage } from "@droposs/plugin-sdk";
import { type RetroAchievement, parseAchievements } from "./achievements.js";

export type HttpFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export const RA_API_BASE = "https://retroachievements.org";
export const RA_CREDENTIALS_KEY = "ra_credentials";

/**
 * RetroAchievements endpoints block generic tool user-agents (e.g. curl/8.x
 * return 403). We send an identifiable plugin User-Agent header per community
 * and integration best practices.
 */
export const RA_USER_AGENT = "drop-retroachievements/0.1.0 (+https://github.com/Heretek-Games/drop-retroachievements)";

export interface RaCredentials {
  username: string;
  apiKey: string;
}

export interface RaProgress {
  gameId: number;
  title: string;
  total: number;
  earned: number;
  achievements: RetroAchievement[];
}

export interface RaClientOptions {
  fetchFn: HttpFetch;
  credentials: RaCredentials;
}

/** Reads `{ Success, GameID }` from a `dorequest.php?r=gameid` response. */
export function parseResolvedGameId(payload: unknown): number | null {
  const body = (payload ?? {}) as Record<string, unknown>;
  const success = body.Success ?? body.success;
  if (success === false || success === "false") return null;
  const gameId = Number(body.GameID ?? body.gameId ?? 0);
  return Number.isFinite(gameId) && gameId > 0 ? gameId : null;
}

/** Resolves an MD5 ROM hash to a RetroAchievements game id. */
export async function resolveGameId(
  options: Pick<RaClientOptions, "fetchFn">,
  hash: string,
): Promise<number | null> {
  const response = await options.fetchFn(
    `${RA_API_BASE}/dorequest.php?r=gameid&m=${encodeURIComponent(hash)}`,
    { headers: { "User-Agent": RA_USER_AGENT } },
  );
  if (!response.ok) {
    throw new Error(
      `RetroAchievements hash lookup failed: HTTP ${response.status}`,
    );
  }
  return parseResolvedGameId(await response.json());
}

/** Parses `API_GetGameInfoAndUserProgress.php` into a compact progress summary. */
export function parseGameProgress(payload: unknown): RaProgress {
  const body = (payload ?? {}) as Record<string, unknown>;
  const achievements = parseAchievements(payload);
  const rawTotal = Number(
    body.NumAchievements ?? body.numAchievements ?? achievements.length,
  );
  return {
    gameId: Number(body.ID ?? body.id ?? 0),
    title: String(body.Title ?? body.title ?? "Unknown"),
    total: Number.isFinite(rawTotal) ? rawTotal : achievements.length,
    earned: achievements.filter(
      (achievement) => achievement.earned || achievement.earnedHardcore,
    ).length,
    achievements,
  };
}

/** Fetches a user's live progress for a game using stored credentials. */
export async function fetchGameProgress(
  options: RaClientOptions,
  gameId: number,
): Promise<RaProgress> {
  const params = new URLSearchParams({
    g: String(gameId),
    u: options.credentials.username,
    y: options.credentials.apiKey,
  });
  const response = await options.fetchFn(
    `${RA_API_BASE}/API/API_GetGameInfoAndUserProgress.php?${params.toString()}`,
    { headers: { "User-Agent": RA_USER_AGENT } },
  );
  if (!response.ok) {
    throw new Error(
      `RetroAchievements progress fetch failed: HTTP ${response.status}`,
    );
  }
  const progress = parseGameProgress(await response.json());
  return { ...progress, gameId: progress.gameId || gameId };
}

/** Stored credentials take precedence over the environment fallback. */
export async function readCredentials(
  storage: PluginStorage,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RaCredentials | null> {
  const stored = await storage.get<Partial<RaCredentials>>(RA_CREDENTIALS_KEY);
  if (stored?.username && stored?.apiKey) {
    return { username: stored.username, apiKey: stored.apiKey };
  }
  if (env.RETROACHIEVEMENTS_USER && env.RETROACHIEVEMENTS_API_KEY) {
    return {
      username: env.RETROACHIEVEMENTS_USER,
      apiKey: env.RETROACHIEVEMENTS_API_KEY,
    };
  }
  return null;
}

export function knownAchievementsKey(
  username: string,
  gameId: number,
): string {
  return `known:${username}:${gameId}`;
}

export async function loadKnownAchievements(
  storage: PluginStorage,
  username: string,
  gameId: number,
): Promise<Set<string>> {
  const keys = await storage.get<string[]>(
    knownAchievementsKey(username, gameId),
  );
  return new Set(Array.isArray(keys) ? keys : []);
}

/** Merges newly unlocked keys into the per-user/per-game known set. */
export async function saveKnownAchievements(
  storage: PluginStorage,
  username: string,
  gameId: number,
  newKeys: Iterable<string>,
): Promise<string[]> {
  const known = await loadKnownAchievements(storage, username, gameId);
  for (const key of newKeys) known.add(key);
  const merged = [...known].sort((a, b) => a.localeCompare(b));
  await storage.set(knownAchievementsKey(username, gameId), merged);
  return merged;
}
