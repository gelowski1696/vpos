# Transfer Ops Health Checks

## Purpose
- Monitor transfer lifecycle backlog and transfer-related sync review pressure.
- Provide a strict ops gate for unattended scheduler runs.

## Script
- `apps/api/scripts/transfer-ops-health.mjs`

## Commands
```powershell
pnpm ops:transfers:health
pnpm --filter @vpos/api ops:transfers:health -- --strict
```

## What It Checks
- `CREATED` transfers older than `OPS_TRANSFER_CREATED_STALE_MINUTES`.
- `APPROVED` transfers older than `OPS_TRANSFER_APPROVED_STALE_MINUTES`.
- Open transfer sync reviews (`SyncReview.entity = transfer`) against `OPS_TRANSFER_OPEN_REVIEW_THRESHOLD`.

## Threshold Env Vars
- `OPS_TRANSFER_CREATED_STALE_MINUTES` (default: `30`)
- `OPS_TRANSFER_APPROVED_STALE_MINUTES` (default: `30`)
- `OPS_TRANSFER_OPEN_REVIEW_THRESHOLD` (default: `1`)

## Strict Mode Behavior
- Exit code `2` when any stale transfer backlog exists or open transfer reviews meet/exceed threshold.

## Suggested Incident Actions
1. Review `CREATED`/`APPROVED` records in transfer list and verify blocked approver/post flow.
2. Check open transfer sync reviews and resolve invalid payloads or stock-state conflicts.
3. Re-run strict health check after corrective posting/reversal/resolution.

