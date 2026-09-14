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
 * Parses the `Achievements` block of `API_GetGameInfoAndUserProgress.php`.
 * Tolerates both object-map and array shapes.
 */
export function parseAchievements(payload: unknown): RetroAchievement[] {
  const body = (payload ?? {}) as Record<string, unknown>;
  const raw = body.Achievements;
  const entries: Array<[string, Record<string, unknown>]> = Array.isArray(raw)
    ? raw.map((entry, index) => [String(index), (entry ?? {}) as Record<string, unknown>])
    : Object.entries((raw ?? {}) as Record<string, Record<string, unknown>>);

  return entries.map(([fallbackId, entry]) => ({
    id: Number(entry.ID ?? fallbackId),
    title: String(entry.Title ?? "Unknown"),
    points: Number(entry.Points ?? 0),
    earned: Number(entry.DateEarned ?? 0) > 0,
    earnedHardcore: Number(entry.DateEarnedHardcore ?? 0) > 0,
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
