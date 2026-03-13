# Hybrid Tenancy Incident Playbook (Task 7.5 Start)

## Scope
- Dedicated datastore routing failures.
- Dedicated datastore schema/mapping drift.
- Owner-console strict health check failures.

## Severity Guide
- `SEV-1`:
  - Multiple dedicated tenants down, or platform-wide routing failures.
- `SEV-2`:
  - Single dedicated tenant outage.
- `SEV-3`:
  - Migration state drift or mapping drift with no active outage.

## Immediate Triage
1. Capture failing tenant identifiers:
   - `company_id`
   - `client_id`
   - `datastore_ref`
2. Run strict check:
```powershell
pnpm --filter @vpos/api ops:hybrid:health -- --strict
```
3. Validate owner endpoint (if API is up):
```http
GET /api/platform/owner/tenants/datastore-health?strict=true
```
4. Inspect API logs for:
   - `Dedicated datastore URL is not configured`
   - `Dedicated datastore unavailable`
   - `Dedicated datastore schema is not ready`

## Recovery Actions

### Case A: Missing dedicated URL mapping
1. Confirm tenant has `datastore_ref`.
2. Register mapping in datastore registry path (preferred) by running tenant routing/provision flow.
3. Temporary fallback (if needed): set `VPOS_DEDICATED_DB_URLS_JSON` or `VPOS_DEDICATED_DB_URL_<REF>`.
4. Re-run strict check.

### Case B: Schema not ready in dedicated DB
1. Run dedicated migration deploy for affected datastore URL.
2. Validate required tables exist (`Branch` and core tables).
3. Re-run strict check.

### Case C: Dedicated DB unreachable
1. Verify Postgres host/network credentials.
2. Check DB connection limits and TLS settings.
3. Restore service, then run strict check.

## Fail-Closed Policy
- Keep strict checks enabled for owner monitoring and automation.
- If strict fails:
  - block “healthy” declaration for dedicated tenant operations,
  - escalate incident with affected tenant list.

## Post-Incident Checklist
1. Record root cause and timeline.
2. Attach strict health JSON output before/after fix.
3. Add permanent guardrail:
   - provisioning validation
   - registry/migration automation improvement
4. Update `docs/TASKS2.md` progress and residual risk notes.
