# Relatório de teste — campaign-messages (unitário, todas as camadas existentes)

**Data:** 2026-11-02
**Repositório:** `projects/campaign-messages`
**Raiz de testes:** `tests/` (sem `src/tests/`, sem Playwright, sem URL de sala)
**Runner:** Jest + ts-jest, `tests/jest.config.cjs`, ambiente `node`, `testMatch` `**/*.spec.ts`
**Autor:** Lucas (somente análise estática; os testes são executados por Bruno)

## 1. Fluxo do caso de uso

O serviço envia mensagens de campanha por meio de um provedor e acompanha o status delas.

1. **Criar** — `POST /campaigns`: `parseCreateCampaign` valida o corpo; `ingestContacts` normaliza o telefone, renderiza o template e rejeita contatos na ordem `invalid_number` → `missing_variable` → `duplicate`; `CreateCampaign` persiste via `CampaignCreator` (mesmo com 0 aceitos) e devolve o id, a quantidade de aceitos e a lista de rejeitados.
2. **Iniciar** — `POST /campaigns/:id/start`: `StartCampaign` chama `CampaignStarter.markRunningIfDraft`; quando acabou de iniciar, chama `FinishCampaignIfDone` (cobre 0 aceitos) e responde `running`; `unchanged` devolve o status existente; `not_found` encerra.
3. **Loop de envio** — `SendWorker.tick` reserva `MAX_IN_FLIGHT (5) - inFlight` vagas, faz o claim das mensagens vencidas (`now`, `staleBefore = now - CLAIM_TTL_MS`) e despacha cada uma para `ProcessClaimedMessage`, que chama `MessageProvider.send`, classifica os erros (`classifyProviderError`), decide o retry (`decideAfterTransient`: 200/800/2000 ms, depois `provider_unavailable`) e registra o resultado via `MessageOutcomeStore`; somente `sent`/`failed` chamam `FinishCampaignIfDone`.
4. **Webhook** — `POST /webhooks/provider`: `parseWebhookEvent` valida; `ApplyProviderWebhook` entrega o evento e um decisor baseado em `decideWebhook` ao `ProviderWebhookStore` (idempotente pelo id do evento).
5. **Leitura** — `GET /campaigns/:id` (`GetCampaign`) e `GET /campaigns/:id/failures?page=` (`ListCampaignFailures`, tamanho de página 50).
6. **Transporte** — `handlers.ts` (`parseCampaignId`, `handle*`) e `httpMapping.ts` (`map*`, `badRequest`) transformam os resultados dos casos de uso em `{ status, body }`; `expressApp.ts` faz a ligação com o Express.

## 2. Arquivos envolvidos (lidos por inteiro)

- `src/domain/`: `phone.ts`, `template.ts`, `rules.ts`, `createCampaignInput.ts`, `webhookEvent.ts`, `messageTransitions.ts`, `retryPolicy.ts`, `providerFailure.ts`, `campaignFinish.ts`, `campaignStatus.ts`, `messageStatus.ts`
- `src/application/`: `CreateCampaign.ts`, `StartCampaign.ts`, `GetCampaign.ts`, `ListCampaignFailures.ts`, `ApplyProviderWebhook.ts`, `FinishCampaignIfDone.ts`, `ProcessClaimedMessage.ts`, `SendWorker.ts`, `workerConfig.ts`
- `src/controller/`: `handlers.ts`, `httpMapping.ts`, `expressApp.ts`
- `src/ports/`: `campaignRepository.ts`, `Clock.ts`, `MessageProvider.ts`

## 3. Arquivos de teste

| Camada | Arquivo |
|---|---|
| auxiliares | `tests/helpers/fakes.ts` (fakes de todas as portas, builders, `stubUseCase`, `createDeferred`, `flushMicrotasks`) |
| domínio | `tests/domain/unit/{phone,template,rules,createCampaignInput,webhookEvent,messageTransitions,retryPolicy,providerFailure,campaignFinish,status}.spec.ts` |
| aplicação | `tests/application/unit/{CreateCampaign,StartCampaign,GetCampaign,ListCampaignFailures,ApplyProviderWebhook,FinishCampaignIfDone,ProcessClaimedMessage,SendWorker}.spec.ts` |
| controlador | `tests/controller/unit/{handlers,httpMapping}.spec.ts` |

## 4. Plano de testes

### Unitário — domínio
- [x] `normalizePhone` — mantém somente os dígitos
- [x] `isValidPhone` — tamanho 10–15, terminar em `0000` é inválido
- [x] `extractPlaceholders` — `[A-Za-z0-9_]+`, distintos, em ordem, chaves inválidas ignoradas
- [x] `renderTemplate` — renderização, chave ausente, string vazia, valor não string, chaves extras ignoradas, `{{constructor}}` não lê o protótipo
- [x] `parsePage` — `undefined` → 1; 0, negativo, não inteiro e não numérico são inválidos; string de dígitos aceita
- [x] constantes de `rules` — `CLAIM_TTL_MS`, `PAGE_SIZE`, `PHONE_MIN`, `PHONE_MAX`
- [x] `parseCreateCampaign` — formatos inválidos e válidos
- [x] `ingestContacts` — ordem de rejeição, duplicado somente contra os aceitos, telefone rejeitado não reserva o duplicado, contato que não é objeto, telefone que não é string, todos rejeitados ainda devolve as duas listas
- [x] `parseWebhookEvent` — campo ausente, status inválido, motivo somente para `failed`
- [x] `decideWebhook` — matriz completa (status da mensagem × status do webhook), motivo padrão `provider_failed`
- [x] `classifyProviderError` — 400 `invalid_number` / `invalid_payload` / outros, sem status, não objeto
- [x] `decideAfterTransient` — tentativas 0/1/2 → 200/800/2000, ≥ 3 failed
- [x] `shouldFinish` — somente `running` com 0 na fila
- [x] `CAMPAIGN_STATUS` / `MESSAGE_STATUS` — os códigos existem

### Unitário — aplicação
- [x] `CreateCampaign` — corpo inválido não chama a porta; válido devolve id, aceitos, rejeitados; todos rejeitados ainda chama o criador
- [x] `StartCampaign` — `started` chama finish e devolve `running`; `unchanged` e `not_found` não chamam finish
- [x] `GetCampaign` — `null` → `not_found`; resumo → `ok`
- [x] `ListCampaignFailures` — página inválida não chama a porta; `null` → `not_found`; `ok` com `pageSize` 50
- [x] `ApplyProviderWebhook` — inválido não chama a porta; válido passa um decisor; `duplicate` / `unknown_message` → `ok`
- [x] `FinishCampaignIfDone` — `null` não faz nada; `running` com 0 na fila marca como finalizada; caso contrário não
- [x] `ProcessClaimedMessage` — sucesso, permanente, retry transitório, transitório esgotado, erro do repositório se propaga
- [x] `SendWorker.tick` — limite `5 - inFlight`, `staleBefore = now - 30000`, despacho, execute rejeitado, nenhum claim com 5 em andamento
- [x] `SendWorker.start` / `stop` — além da lista do humano (timers falsos), sinalizado na entrega

### Unitário — controlador
- [x] `parseCampaignId` — ids malformados (`0`, `07`, `abc`, acima de `MAX_SAFE_INTEGER`) → `null`
- [x] `handleCreateCampaign` — inválido 400 `{}`; criado 201 sem `kind`
- [x] `handleStartCampaign` — id malformado 400 sem chamar o caso de uso; 404 `{}`; 202 `{ status }`
- [x] `handleGetCampaign` — id malformado 400; 404; 200 com totais
- [x] `handleListCampaignFailures` — id malformado 400; inválido 400; 404; 200
- [x] `handleProviderWebhook` — inválido 400 `{}`; ok 200 `{}`
- [x] `badRequest` e toda função `map*` — status e corpo por ramo
- [ ] 🔒 `createApp` (`expressApp.ts`) — as rotas e o `jsonParseErrorHandler` precisam de uma requisição HTTP (`supertest`) (ver [refactoring/express-app.md](../refactoring/express-app.md))

### Portas
Somente interfaces e tipos (`campaignRepository.ts`, `Clock.ts`, `MessageProvider.ts`). Não têm comportamento, então nenhum teste foi inventado para elas. São exercitadas indiretamente pelos fakes em `tests/helpers/fakes.ts`.

### Integração
- [ ] 🔒 N/A — sem banco e sem provedor neste marco; os testes são unitários com fakes das portas.

### E2E
Fora do escopo (decisão do humano): sem E2E, sem Playwright, sem URL de sala.

## 5. Notas de refatoração

- Rotas de `createApp` e o `jsonParseErrorHandler` privado: ver [refactoring/express-app.md](../refactoring/express-app.md).
