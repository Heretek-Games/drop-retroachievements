# Drop RetroAchievements

RetroAchievements.org integration plugin for Drop (#8).

## API

- `POST /config` — store `{ username, apiKey }` in plugin storage (the key is
  never returned or logged). Falls back to `RETROACHIEVEMENTS_USER` /
  `RETROACHIEVEMENTS_API_KEY`.
- `GET /config` — `{ configured, username }`.
- `GET /games/:hash` — resolves the ROM hash via
  `dorequest.php?r=gameid&m=<hash>`, then returns the user's live progress from
  `API_GetGameInfoAndUserProgress.php` (`{ linked, gameId, title, total, earned }`).
- `POST /sync` — accepts `{ gameId }` or `{ hash }`, fetches live progress,
  computes unlocks with `newlyUnlocked`, persists known keys per
  user/game (`known:<user>:<gameId>`), broadcasts only new
  `drop:achievement:unlock` events, and returns the sync summary. The legacy
  `{ progress, knownAchievements }` payload shape is still accepted.

## Build

```sh
npm ci
npm run build
npm test
npm run typecheck
```
