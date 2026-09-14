/**
 * RetroAchievements progress mapping (#8).
 *
 * The RetroAchievements API returns a user's achievement progress per game. This
 * module turns that payload into neutral unlock events that `drop-gse`/the
 * desktop client forward to the core `POST /api/v1/client/achievements/unlock`.
 */
export interface RetroAchievement {
  id: number;
  title: string;
  points: number;
  earned: boolean;
  earnedHardcore: boolean;
}

export interface UnlockEvent {
  key: string;
  title: string;
  points: number;
  hardcore: boolean;
}

/**
 * Whether a `DateEarned`/`DateEarnedHardcore` value marks an achievement as
 * earned. The API returns either `0` (unearned), a unix timestamp, or a date
 * string such as `"2016-03-12 17:47:29"`.
 */
export function parseEarned(value: unknown): boolean {
  if (value === null || value === undefined || value === 0 || value === "0") {
    return false;
  }
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === "0") return false;
    if (/^\d+$/.test(trimmed)) return Number(trimmed) > 0;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return false;
}

function pick(
  entry: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (entry[key] !== undefined) return entry[key];
  }
  return undefined;
}

/**
 * Parses the achievements block of `API_GetGameInfoAndUserProgress.php`.
 * Tolerates object-map and array shapes, and both the legacy `Achievements`/
 * `DateEarned` casing and the newer lowercase API casing.
 */
export function parseAchievements(payload: unknown): RetroAchievement[] {
  const body = (payload ?? {}) as Record<string, unknown>;
  const raw = body.Achievements ?? body.achievements;
  const entries: Array<[string, Record<string, unknown>]> = Array.isArray(raw)
    ? raw.map((entry, index) => [String(index), (entry ?? {}) as Record<string, unknown>])
    : Object.entries((raw ?? {}) as Record<string, Record<string, unknown>>);

  return entries.map(([fallbackId, entry]) => ({
    id: Number(pick(entry, "ID", "id") ?? fallbackId),
    title: String(pick(entry, "Title", "title") ?? "Unknown"),
    points: Number(pick(entry, "Points", "points") ?? 0),
    earned: parseEarned(pick(entry, "DateEarned", "dateEarned")),
    earnedHardcore: parseEarned(
      pick(entry, "DateEarnedHardcore", "dateEarnedHardcore"),
    ),
  }));
}

/** Achievement keys that were earned but are not yet known locally. */
export function newlyUnlocked(
  knownKeys: Set<string>,
  achievements: RetroAchievement[],
): UnlockEvent[] {
  return achievements
    .filter((achievement) => achievement.earned || achievement.earnedHardcore)
    .map((achievement) => ({
      key: `ra:${achievement.id}`,
      title: achievement.title,
      points: achievement.points,
      hardcore: achievement.earnedHardcore,
    }))
    .filter((event) => !knownKeys.has(event.key));
}
