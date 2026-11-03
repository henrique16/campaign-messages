# Relatório de teste — campaign-messages (integração, infraestrutura do Marco 7)

**Data:** 2026-11-02
**Repositório:** `projects/campaign-messages`
**Raiz de testes:** `tests/` (sem `src/tests/`, sem Playwright, sem URL de sala, sem supertest, sem HTTP)
**Runner:** Jest + ts-jest, `tests/jest.config.cjs`, ambiente `node`, `testMatch` `**/*.spec.ts`, `--runInBand`
**Autor:** Lucas (somente análise estática; os testes são executados por Bruno)
**Relatório relacionado:** [2026-11-02-campaign-messages-unit.md](2026-11-02-campaign-messages-unit.md) (290 testes unitários, não alterado)

## 1. Fluxo do caso de uso

A infraestrutura real por trás das portas:

- **`MySqlCampaignRepository`** — emite somente `CALL <procedure>` no MySQL 8 (`mysql/002_procedures.sql`). Cada procedure é dona da própria transação, exceto `applyWebhookEvent`, que mantém uma conexão e uma transação ao longo de `webhook_open` → `decide` em TypeScript → `webhook_apply` (o lock de linha da mensagem é mantido enquanto `decide` executa; `unknown`/`duplicate` fazem rollback, `applied` faz commit).
- **`claim_due`** — seleciona mensagens `queued` de campanhas `running` com `next_attempt_at <= now` e sem claim ou com `claimed_at < staleBefore`, `ORDER BY id LIMIT n FOR UPDATE OF m SKIP LOCKED`, e substitui a linha de claim por `claimed_at = now`.
- **`FakeProviderAdapter`** — delega para o `fakeProvider.js` da raiz, que lê `FAKE_FAIL_RATE` uma única vez no carregamento do módulo.
- **`SystemClock`** — devolve `new Date()`; não há comportamento a integrar (não coberto, ver §5).

## 2. Arquivos envolvidos (lidos por inteiro)

- `src/infrastructure/mysql/MySqlCampaignRepository.ts`, `src/infrastructure/provider/FakeProviderAdapter.ts`, `src/infrastructure/system/SystemClock.ts`
- `src/ports/campaignRepository.ts`, `src/domain/messageTransitions.ts` (`decideWebhook`), `src/domain/webhookEvent.ts`, `src/domain/createCampaignInput.ts`, `src/domain/messageStatus.ts`
- `fakeProvider.js` (somente leitura), `mysql/001_schema.sql`, `mysql/002_procedures.sql`, `docker-compose.yml` (credenciais do MySQL, porta 3306 publicada)

## 3. Arquivos de teste

| Camada | Arquivo |
|---|---|
| auxiliar | `tests/helpers/mysqlTestDb.ts` (pool a partir do env, limpeza segura quanto a FK, factory do repositório, leituras diretas, builder de telefone, `NOW` fixo) |
| integração | `tests/infrastructure/integration/mysqlCampaignRepository.campaigns.spec.ts` (casos 1–5) |
| integração | `tests/infrastructure/integration/mysqlCampaignRepository.claims.spec.ts` (casos 6–9) |
| integração | `tests/infrastructure/integration/mysqlCampaignRepository.webhooks.spec.ts` (caso 10) |
| integração | `tests/infrastructure/integration/fakeProviderAdapter.spec.ts` (casos 11–12) |

## 4. Ambiente e isolamento

- Conexão por `mysql2/promise`, variáveis de ambiente com os padrões do compose: `MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=3306`, `MYSQL_USER=campaign`, `MYSQL_PASSWORD=campaign`, `MYSQL_DATABASE=campaign_messages`. Timezone do pool `Z`.
- Precisa de `docker compose up mysql mysql-migrate` (schema e procedures aplicados). **As suítes nunca são ignoradas quando o MySQL está fora do ar**: uma conexão recusada faz os testes falharem.
- O `beforeEach` apaga via mysql2, nesta ordem: `webhook_events`, `message_failures`, `message_claims`, `message_provider_ids`, `messages`, `campaigns`. `campaign_statuses` e `message_statuses` nunca são apagadas.
- O clock do repositório não é usado. Os testes passam um `now` fixo num futuro distante (`2100-01-01T00:00:00.000Z`) para `claimDue`, de modo que `messages.next_attempt_at = UTC_TIMESTAMP(3)` (definido pelo banco na criação) seja sempre `<= now`, independentemente da defasagem de relógio entre host e banco.
- Não rode o container da API nem qualquer outro escritor no mesmo banco enquanto isso executa.

## 5. Plano de testes

### Unitário backend
- [x] Coberto pelo relatório existente [2026-11-02-campaign-messages-unit.md](2026-11-02-campaign-messages-unit.md) (290 testes, domínio/aplicação/controlador). Não recriado.

### Unitário frontend
- [ ] 🔒 N/A — não há frontend

### Integração — MySQL (`MySqlCampaignRepository`, procedures reais)
- [x] 1a. `createCampaignWithMessages` com contatos — a campanha é `draft`, `getSummary` conta N em `queued`, os demais totais são 0
- [x] 1b. `createCampaignWithMessages` com array de aceitos vazio — a campanha existe, todos os totais são 0
- [x] 1c. Mensagens com claim continuam contando como `queued` em `getSummary`
- [x] 2. Dois telefones idênticos em uma mesma chamada de criação rejeitam a chamada inteira (`ER_DUP_ENTRY`) e não deixam campanha nem linhas de mensagem
- [x] 3. O mesmo telefone em duas campanhas diferentes é permitido
- [x] 4a. `markRunningIfDraft`: id inexistente → `not_found`; draft → `started`; segunda chamada → `unchanged` com `running`
- [x] 4b. `markFinished` move somente `running` para `finished`; uma `draft` continua `draft`
- [x] 5a. `listFailures` de uma campanha inexistente → `null`
- [x] 5b. Depois de `recordFailed` (registrado fora da ordem de id), a página é ordenada pelo id da mensagem e o tamanho de página é respeitado
- [x] 5c. Uma página além do fim → `items` vazio com o `total` correto; não encontrado continua `null`
- [x] 6a. `recordSent` move a mensagem para `sent`
- [x] 6b. `recordRetry` mantém `queued`, guarda `attemptCount` e `nextAttemptAt`; `claimDue` não a devolve antes desse horário e a devolve depois (com `attemptCount`)
- [x] 7a. `claimDue` ignora mensagens de campanhas `draft`
- [x] 7b. `claimDue` ignora `next_attempt_at` no futuro
- [x] 7c. `claimDue` respeita `limit` (menores ids primeiro)
- [x] 8. Duas chamadas de `claimDue` sobrepostas nunca devolvem o mesmo `messageId`
- [x] 9a. Um claim não liberado é reivindicado de novo quando `staleBefore` é posterior ao seu `claimed_at`
- [x] 9b. `staleBefore` igual ao horário do claim não o reivindica de novo
- [x] 10a. Webhook, `providerMessageId` desconhecido → `unknown_message`, resumo inalterado, nenhum evento armazenado
- [x] 10b. `delivered` em `sent` → conta `delivered`, e não também `sent`
- [x] 10c. Mesmo `eventId` de novo → `duplicate`, totais inalterados
- [x] 10d. `read` em `sent` é contado como `read`, e não também `delivered`
- [x] 10e. `failed` a partir de `sent`, depois um novo evento que levaria a `delivered` é ignorado: continua `failed`, o motivo da falha permanece
- [x] 10f. Esse evento ignorado ainda é armazenado: repetir o seu `eventId` → `duplicate`

### Integração — `FakeProviderAdapter` (`fakeProvider.js` real)
- [x] 11a. `FAKE_FAIL_RATE=0`: `send` normal resolve `{ providerMessageId }` começando com `pm_`
- [x] 11b. `FAKE_FAIL_RATE=0`: `to` terminando em `0000` rejeita com `status` 400, `invalid_number`
- [x] 11c. `FAKE_FAIL_RATE=0`: `body` vazio rejeita com `status` 400, `invalid_payload`
- [x] 12. `FAKE_FAIL_RATE=1`: `send` normal rejeita com `status` 503, `provider_unavailable`
- O módulo é recarregado com `jest.resetModules()` + `import()` dinâmico para cada taxa. O caminho aleatório de 0.2 não é verificado. 4 envios no total (50–200 ms cada).

### E2E
- [ ] 🔒 N/A — sem navegador e sem sala

## 6. Não coberto, de propósito

- HTTP / `expressApp` — bloqueado em [refactoring/express-app.md](../refactoring/express-app.md); sem supertest nesta tarefa.
- `SystemClock` — `new Date()` de uma linha, nada a integrar; fora dos casos solicitados.
- `SendWorker` contra o repositório real — não solicitado.

## 7. Achados para o dev

- `applyWebhookEvent` devolve `'applied'` também quando `decide` devolve `ignore` (o evento é armazenado, o status não muda). Por isso o caso de ignorar é verificado pelo resumo e pela lista de falhas, e o evento armazenado, por `duplicate`.
