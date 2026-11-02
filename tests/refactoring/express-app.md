# Refactoring note — `expressApp.ts`

- **Function:** `createApp` (routes) and `jsonParseErrorHandler` (private, not exported).
- **File:** `src/controller/expressApp.ts`
- **Why it is not unit-tested:** the routes and the JSON-parse 400 only run when a real HTTP request goes through the app, which needs `supertest` (not allowed: no new dependencies) or `listen` (not allowed: no server boot); `jsonParseErrorHandler` is not exported.
- **Suggestions (not applied):** add `supertest` as a devDependency in a later milestone, or export `jsonParseErrorHandler` and `toRoute` so they can be called with fake `req`/`res`. The decision to refactor belongs to the dev.

What *is* covered: every decision the routes delegate to (`handlers.ts` and `httpMapping.ts`), in `tests/controller/unit/`.
