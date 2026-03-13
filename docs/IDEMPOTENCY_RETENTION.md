# Sync Idempotency Retention

Use this to clean old `IdempotencyKey` rows after replay windows have passed.

## Commands
- Dry run:
  - `pnpm --filter @vpos/api ops:idempotency:cleanup:dry-run`
- Apply:
  - `pnpm --filter @vpos/api ops:idempotency:cleanup:apply`

## Optional Days Override
- Dry run:
  - `pnpm --filter @vpos/api exec node ./scripts/cleanup-idempotency-keys.mjs --days 30`
- Apply:
  - `pnpm --filter @vpos/api exec node ./scripts/cleanup-idempotency-keys.mjs --days 30 --apply`

## Notes
- Script operates on the datastore pointed by current `DATABASE_URL`.
- In hybrid mode, run this per datastore (shared + each dedicated datastore).
- Recommended baseline retention is 90 days unless policy requires longer.
