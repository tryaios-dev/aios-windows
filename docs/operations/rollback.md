# Rollback procedure (C-04)

What to do when a released AIOS version must be withdrawn. For the release team and IT support.
Last checked against the code on 2026-11-12.

## 1 What the app guarantees

| Guarantee | Where |
| --- | --- |
| The updater never installs an older or pre-release version, even if the feed offers one | `apps/desktop/src/main/updater.ts` (`allowDowngrade = false`, `isNewer`) |
| Only installers signed by the publisher are installed | electron-updater checks `publisherName` (A-01) |
| Before any schema migration, `chats.db` is copied to `backups\chats-<time>.db` with SQLite's online backup, still encrypted, and verified; the 5 newest copies are kept | `services/backend/db/migrate.py` |
| A failed migration puts the copy back and the app does not start on a half-migrated file | `migrate.upgrade` |
| An older version refuses data written by a newer one (unknown schema revision): the backend exits with code 4 and the app says "Your data was last opened by a newer version of AIOS… Your data has not been changed", with Quit only | `migrate.check_not_newer`, `apps/desktop/src/main/startup.ts` |
| Uninstalling keeps the data unless the user explicitly answers Yes to "remove data" (default No; never asked during an update) | `build/installer/installer.nsh` |
| `evidence.db` is never rolled back: the chain only grows | evidence writer |

## 2 Preferred path: roll forward

Because downgrades are blocked, the normal fix is a new version with a higher number.
1. Stop the rollout. Replace `latest.yml` on the update feed with the previous good release's
   `latest.yml` (B-06 hosting). Clients that have not updated stay where they are. Clients
   that did update are not moved back, because the updater refuses older versions.
2. Build the fix as `x.y.(z+1)`: the previous good code plus the fix, or the bad release with
   the fault removed. Do not remove or edit a migration that the bad release shipped (CLAUDE.md:
   never edit an applied migration). If its schema change must be undone, add a new migration.
3. Sign it and publish it through `release.yml` as usual. Clients pick it up at the next daily
   check, or right away with Settings > General > Check now.

## 3 Manual reinstall of an older version (support only)

Use this only when the fixed version cannot wait.

1. Note the user's version (Settings > About) and whether the bad release had a migration (see
   its release notes, `services/backend/db/migrations/versions/`).
2. **No migration in the bad release:** run the older signed installer over it. Data and keys
   are kept. Done.
3. **A migration in the bad release:** the older version will refuse the data (exit code 4), and
   that is intended. Either wait for the roll-forward, or, with the user's agreement:
   1. Quit AIOS.
   2. In `%LOCALAPPDATA%\AIOS\data\`, rename `chats.db` to `chats.db.newer` (keep it).
   3. Copy the newest `backups\chats-<time>.db` made **before** the bad update to `chats.db`.
      The name is the UTC time it was taken.
   4. Install the older signed version and start it.

   Messages written after that backup are not in the restored file. They are still in
   `chats.db.newer`, which a fixed later version can open. The evidence log is not rolled
   back. Events recorded in between remain in the chain, and the evidence screen may show
   events the restored database does not mirror. Record the rollback in the support ticket.
4. Never copy `evidence.db` from a backup over the current one. A shorter chain is reported as
   `truncated`, or as `branched` once new events are added.

## 4 Checks after a rollback

- The app starts and Settings > About shows the expected version.
- `GET /health` reports `components.evidence_writer` = `ok`, and the evidence screen shows no
  events still pending after a minute.
- Exporting the evidence and running `aios-verify` on it gives `intact`, or `branched` with a
  branch point that matches a known restore.
