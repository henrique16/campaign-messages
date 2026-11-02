# Test report — campaign-messages (integration, Marco 7 infrastructure)

**Date:** 2026-11-02
**Repo:** `projects/campaign-messages` (standalone exercise — not GoBrunch, not Savanna Bay)
**Test root:** `tests/` (no `src/tests/`, no Playwright, no room URL, no supertest, no HTTP)
**Runner:** Jest + ts-jest, `tests/jest.config.cjs`, environment `node`, `testMatch` `**/*.spec.ts`, `--runInBand`
**Author:** Lucas (static analysis only; tests are executed by Bruno)
**Related report:** [2026-11-02-campaign-messages-unit.md](2026-11-02-campaign-messages-unit.md) (290 unit tests, not touched)

## 1. Use case flow

The real infrastructure behind the ports:

- **`MySqlCampaignRepository`** — emits only `CALL <procedure>` against MySQL 8 (`mysql/002_procedures.sql`). Each procedure owns its transaction, except `applyWebhookEvent`, which holds one connection and one transaction across `webhook_open` → TypeScript `decide` → `webhook_apply` (row lock on the message kept while `decide` runs; `unknown`/`duplicate` roll back, `applied` commits).
- **`claim_due`** — picks `queued` messages of `running` campaigns with `next_attempt_at <= now` and no claim or `claimed_at < staleBefore`, `ORDER BY id LIMIT n FOR UPDATE OF m SKIP LOCKED`, replaces the claim row with `claimed_at = now`.
- **`FakeProviderAdapter`** — delegates to the root `fakeProvider.js`, which reads `FAKE_FAIL_RATE` once at module load.
- **`SystemClock`** — returns `new Date()`; no behavior to integrate (not covered, see §5).

## 2. Files involved (read in full)

- `src/infrastructure/mysql/MySqlCampaignRepository.ts`, `src/infrastructure/provider/FakeProviderAdapter.ts`, `src/infrastructure/system/SystemClock.ts`
- `src/ports/campaignRepository.ts`, `src/domain/messageTransitions.ts` (`decideWebhook`), `src/domain/webhookEvent.ts`, `src/domain/createCampaignInput.ts`, `src/domain/messageStatus.ts`
- `fakeProvider.js` (read-only), `mysql/001_schema.sql`, `mysql/002_procedures.sql`, `docker-compose.yml` (MySQL credentials, port 3306 published)

## 3. Test files

| Layer | File |
|---|---|
| helper | `tests/helpers/mysqlTestDb.ts` (pool from env, FK-safe cleanup, repository factory, raw reads, phone builder, fixed `NOW`) |
| integration | `tests/infrastructure/integration/mysqlCampaignRepository.campaigns.spec.ts` (cases 1–5) |
| integration | `tests/infrastructure/integration/mysqlCampaignRepository.claims.spec.ts` (cases 6–9) |
| integration | `tests/infrastructure/integration/mysqlCampaignRepository.webhooks.spec.ts` (case 10) |
| integration | `tests/infrastructure/integration/fakeProviderAdapter.spec.ts` (cases 11–12) |

## 4. Environment and isolation

- Connection by `mysql2/promise`, env vars with compose defaults: `MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=3306`, `MYSQL_USER=campaign`, `MYSQL_PASSWORD=campaign`, `MYSQL_DATABASE=campaign_messages`. Pool timezone `Z`.
- Needs `docker compose up mysql mysql-migrate` (schema + procedures applied). **The suites never skip when MySQL is down**: a refused connection fails the tests.
- `beforeEach` deletes through mysql2, in this order: `webhook_events`, `message_failures`, `message_claims`, `message_provider_ids`, `messages`, `campaigns`. `campaign_statuses` and `message_statuses` are never deleted.
- The repository clock is not used. Tests pass a fixed far-future `now` (`2100-01-01T00:00:00.000Z`) to `claimDue`, so `messages.next_attempt_at = UTC_TIMESTAMP(3)` (set by the DB at creation) is always `<= now`, independent of host/DB clock skew.
- Do not run the API container or any other writer against the same database while this runs.

## 5. Test plan

### Unit backend
- [x] Covered by the existing report [2026-11-02-campaign-messages-unit.md](2026-11-02-campaign-messages-unit.md) (290 tests, domain/application/controller). Not recreated.

### Unit frontend
- [ ] 🔒 N/A — there is no frontend

### Integration — MySQL (`MySqlCampaignRepository`, real procedures)
- [x] 1a. `createCampaignWithMessages` with contacts — campaign is `draft`, `getSummary` counts N queued, other totals 0
- [x] 1b. `createCampaignWithMessages` with an empty accepted array — campaign exists, all totals 0
- [x] 1c. Claimed messages still count as `queued` in `getSummary`
- [x] 2. Two identical phones in one create call reject the whole call (`ER_DUP_ENTRY`) and leave no campaign and no message rows
- [x] 3. Same phone in two different campaigns is allowed
- [x] 4a. `markRunningIfDraft`: missing id → `not_found`; draft → `started`; second call → `unchanged` with `running`
- [x] 4b. `markFinished` moves only `running` to `finished`; a draft stays `draft`
- [x] 5a. `listFailures` for a missing campaign → `null`
- [x] 5b. After `recordFailed` (recorded out of id order), the page is ordered by message id and the page size is honored
- [x] 5c. A page past the end → empty `items` with the right `total`; not-found stays `null`
- [x] 6a. `recordSent` moves the message to `sent`
- [x] 6b. `recordRetry` keeps `queued`, stores `attemptCount` and `nextAttemptAt`; `claimDue` does not return it before that time and returns it after (with `attemptCount`)
- [x] 7a. `claimDue` ignores messages of `draft` campaigns
- [x] 7b. `claimDue` ignores `next_attempt_at` in the future
- [x] 7c. `claimDue` respects `limit` (lowest ids first)
- [x] 8. Two overlapping `claimDue` calls never return the same `messageId`
- [x] 9a. An unreleased claim is claimed again when `staleBefore` is after its `claimed_at`
- [x] 9b. `staleBefore` equal to the claim time does not reclaim it
- [x] 10a. Webhook, unknown `providerMessageId` → `unknown_message`, summary unchanged, no event stored
- [x] 10b. `delivered` on `sent` → `delivered` counted, not also `sent`
- [x] 10c. Same `eventId` again → `duplicate`, totals unchanged
- [x] 10d. `read` on `sent` is counted as `read`, not also `delivered`
- [x] 10e. `failed` from `sent`, then a new event that would move it to `delivered` is ignored: stays `failed`, failure reason remains
- [x] 10f. That ignored event is still stored: repeating its `eventId` → `duplicate`

### Integration — `FakeProviderAdapter` (real `fakeProvider.js`)
- [x] 11a. `FAKE_FAIL_RATE=0`: normal `send` resolves `{ providerMessageId }` starting with `pm_`
- [x] 11b. `FAKE_FAIL_RATE=0`: `to` ending in `0000` rejects `status` 400, `invalid_number`
- [x] 11c. `FAKE_FAIL_RATE=0`: empty `body` rejects `status` 400, `invalid_payload`
- [x] 12. `FAKE_FAIL_RATE=1`: normal `send` rejects `status` 503, `provider_unavailable`
- Module is reloaded with `jest.resetModules()` + dynamic `import()` per rate. The random 0.2 path is not asserted. 4 sends total (50–200 ms each).

### E2E
- [ ] 🔒 N/A — no browser and no room

## 6. Not covered, on purpose

- HTTP / `expressApp` — locked in [refactoring/express-app.md](../refactoring/express-app.md); no supertest in this task.
- `SystemClock` — one-line `new Date()`, nothing to integrate; not in the requested cases.
- `SendWorker` against the real repository — not requested.

## 7. Findings for the dev

- `applyWebhookEvent` returns `'applied'` also when `decide` returns `ignore` (the event is stored, status unchanged). The ignore case is therefore asserted through the summary and the failure list, and the stored event through `duplicate`.
