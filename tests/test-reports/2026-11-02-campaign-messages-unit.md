# Test report — campaign-messages (unit, all existing layers)

**Date:** 2026-11-02
**Repo:** `projects/campaign-messages` (standalone exercise — not GoBrunch, not Savanna Bay)
**Test root:** `tests/` (no `src/tests/`, no Playwright, no room URL)
**Runner:** Jest + ts-jest, `tests/jest.config.cjs`, environment `node`, `testMatch` `**/*.spec.ts`
**Author:** Lucas (static analysis only; tests are executed by Bruno)

## 1. Use case flow

The service sends campaign messages through a provider and tracks their status.

1. **Create** — `POST /campaigns`: `parseCreateCampaign` validates the body; `ingestContacts` normalizes the phone, renders the template and rejects contacts in the order `invalid_number` → `missing_variable` → `duplicate`; `CreateCampaign` persists via `CampaignCreator` (even with 0 accepted) and returns id, accepted count and rejected list.
2. **Start** — `POST /campaigns/:id/start`: `StartCampaign` calls `CampaignStarter.markRunningIfDraft`; when it just started, it calls `FinishCampaignIfDone` (covers 0 accepted) and answers `running`; `unchanged` returns the existing status; `not_found` ends.
3. **Send loop** — `SendWorker.tick` reserves `MAX_IN_FLIGHT (5) - inFlight` slots, claims due messages (`now`, `staleBefore = now - CLAIM_TTL_MS`), and dispatches each to `ProcessClaimedMessage`, which calls `MessageProvider.send`, classifies errors (`classifyProviderError`), decides retry (`decideAfterTransient`: 200/800/2000 ms, then `provider_unavailable`) and records the outcome via `MessageOutcomeStore`; only `sent`/`failed` call `FinishCampaignIfDone`.
4. **Webhook** — `POST /webhooks/provider`: `parseWebhookEvent` validates; `ApplyProviderWebhook` hands the event and a `decideWebhook`-based decider to `ProviderWebhookStore` (idempotent by event id).
5. **Read** — `GET /campaigns/:id` (`GetCampaign`) and `GET /campaigns/:id/failures?page=` (`ListCampaignFailures`, page size 50).
6. **Transport** — `handlers.ts` (`parseCampaignId`, `handle*`) and `httpMapping.ts` (`map*`, `badRequest`) turn use-case results into `{ status, body }`; `expressApp.ts` wires Express.

## 2. Files involved (read in full)

- `src/domain/`: `phone.ts`, `template.ts`, `rules.ts`, `createCampaignInput.ts`, `webhookEvent.ts`, `messageTransitions.ts`, `retryPolicy.ts`, `providerFailure.ts`, `campaignFinish.ts`, `campaignStatus.ts`, `messageStatus.ts`
- `src/application/`: `CreateCampaign.ts`, `StartCampaign.ts`, `GetCampaign.ts`, `ListCampaignFailures.ts`, `ApplyProviderWebhook.ts`, `FinishCampaignIfDone.ts`, `ProcessClaimedMessage.ts`, `SendWorker.ts`, `workerConfig.ts`
- `src/controller/`: `handlers.ts`, `httpMapping.ts`, `expressApp.ts`
- `src/ports/`: `campaignRepository.ts`, `Clock.ts`, `MessageProvider.ts`

## 3. Test files

| Layer | File |
|---|---|
| helpers | `tests/helpers/fakes.ts` (fakes of every port, builders, `stubUseCase`, `createDeferred`, `flushMicrotasks`) |
| domain | `tests/domain/unit/{phone,template,rules,createCampaignInput,webhookEvent,messageTransitions,retryPolicy,providerFailure,campaignFinish,status}.spec.ts` |
| application | `tests/application/unit/{CreateCampaign,StartCampaign,GetCampaign,ListCampaignFailures,ApplyProviderWebhook,FinishCampaignIfDone,ProcessClaimedMessage,SendWorker}.spec.ts` |
| controller | `tests/controller/unit/{handlers,httpMapping}.spec.ts` |

## 4. Test plan

### Unit — domain
- [x] `normalizePhone` — keeps digits only
- [x] `isValidPhone` — length 10–15, ends with `0000` invalid
- [x] `extractPlaceholders` — `[A-Za-z0-9_]+`, distinct, ordered, invalid keys ignored
- [x] `renderTemplate` — render, missing key, empty string, non-string, extra keys ignored, `{{constructor}}` does not read the prototype
- [x] `parsePage` — `undefined` → 1; 0, negative, non-integer, non-numeric invalid; digit string accepted
- [x] `rules` constants — `CLAIM_TTL_MS`, `PAGE_SIZE`, `PHONE_MIN`, `PHONE_MAX`
- [x] `parseCreateCampaign` — invalid and valid shapes
- [x] `ingestContacts` — rejection order, duplicate only against accepted, rejected phone does not hold the duplicate, non-object contact, non-string phone, all rejected still returns both lists
- [x] `parseWebhookEvent` — missing field, bad status, reason only for `failed`
- [x] `decideWebhook` — full matrix (message status × webhook status), default reason `provider_failed`
- [x] `classifyProviderError` — 400 `invalid_number` / `invalid_payload` / other, no status, non-object
- [x] `decideAfterTransient` — attempts 0/1/2 → 200/800/2000, ≥ 3 failed
- [x] `shouldFinish` — only `running` with 0 queued
- [x] `CAMPAIGN_STATUS` / `MESSAGE_STATUS` — codes exist

### Unit — application
- [x] `CreateCampaign` — invalid body does not call the port; valid returns id, accepted, rejected; all rejected still calls the creator
- [x] `StartCampaign` — `started` calls finish and returns `running`; `unchanged` and `not_found` do not call finish
- [x] `GetCampaign` — `null` → `not_found`; summary → `ok`
- [x] `ListCampaignFailures` — invalid page does not call the port; `null` → `not_found`; `ok` with `pageSize` 50
- [x] `ApplyProviderWebhook` — invalid does not call the port; valid passes a decider; `duplicate` / `unknown_message` → `ok`
- [x] `FinishCampaignIfDone` — `null` does nothing; `running` with 0 queued marks finished; otherwise not
- [x] `ProcessClaimedMessage` — success, permanent, transient retry, transient exhausted, repository error propagates
- [x] `SendWorker.tick` — limit `5 - inFlight`, `staleBefore = now - 30000`, dispatch, rejected execute, no claim at 5 in flight
- [x] `SendWorker.start` / `stop` — extra beyond the human list (fake timers), flagged in the hand-off

### Unit — controller
- [x] `parseCampaignId` — malformed ids (`0`, `07`, `abc`, above `MAX_SAFE_INTEGER`) → `null`
- [x] `handleCreateCampaign` — invalid 400 `{}`; created 201 without `kind`
- [x] `handleStartCampaign` — malformed id 400 without calling the use case; 404 `{}`; 202 `{ status }`
- [x] `handleGetCampaign` — malformed id 400; 404; 200 with totals
- [x] `handleListCampaignFailures` — malformed id 400; invalid 400; 404; 200
- [x] `handleProviderWebhook` — invalid 400 `{}`; ok 200 `{}`
- [x] `badRequest` and every `map*` function — status and body per branch
- [ ] 🔒 `createApp` (`expressApp.ts`) — routes and `jsonParseErrorHandler` need an HTTP request (`supertest`) (see [refactoring/express-app.md](../refactoring/express-app.md))

### Ports
Interfaces and types only (`campaignRepository.ts`, `Clock.ts`, `MessageProvider.ts`). They have no behavior, so no tests were invented for them. They are exercised indirectly through the fakes in `tests/helpers/fakes.ts`.

### Integration
- [ ] 🔒 N/A — sem banco e sem provedor neste marco; os testes são unitários com fakes das portas.

### E2E
Not in scope (human decision): no E2E, no Playwright, no room URL.

## 5. Refactoring notes

- `createApp` routes and the private `jsonParseErrorHandler`: see [refactoring/express-app.md](../refactoring/express-app.md).
