# Nota de refatoração — `expressApp.ts`

- **Função:** `createApp` (rotas) e `jsonParseErrorHandler` (privada, não exportada).
- **Arquivo:** `src/controller/expressApp.ts`
- **Por que não tem teste unitário:** as rotas e o 400 de erro de parse do JSON só executam quando uma requisição HTTP real passa pelo app, o que exige `supertest` (não permitido: sem novas dependências) ou `listen` (não permitido: sem subir servidor); `jsonParseErrorHandler` não é exportado.
- **Sugestões (não aplicadas):** adicionar `supertest` como devDependency em um marco futuro, ou exportar `jsonParseErrorHandler` e `toRoute` para que possam ser chamados com `req`/`res` falsos. A decisão de refatorar é do dev.

O que *está* coberto: toda decisão que as rotas delegam (`handlers.ts` e `httpMapping.ts`), em `tests/controller/unit/`.
