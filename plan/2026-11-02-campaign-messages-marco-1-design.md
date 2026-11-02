# Plano: campaign-messages — Marco 1 (design do sistema)

**Data:** 2026-11-02
**Escopo:** `projects/ai/campaign-messages.md`
**Projeto:** `projects/campaign-messages/`
**Execução:** um marco por vez, na ordem do escopo. Este plano é só o Marco 1 (design). Nada de código, testes, Docker ou SQL aqui.

---

## 1. Decisões travadas

- Stack (definida pelo tech lead): Node.js 18+, TypeScript, Express como adaptador HTTP, Jest, MySQL 8 em Docker Compose. Sem Redis, sem autenticação.
- Provedor: somente `fakeProvider.js`, usado como está (não editar). Sem vendor real de WhatsApp.
- Arquitetura: o domínio depende de **portas** (repositório e provedor de mensagens). O adaptador do provedor envolve `fakeProvider.js`.
- Testes unitários usam repositório em memória. O app rodando (`docker compose up`) usa MySQL.
- Worker em processo dentro da API. Sem segundo container, sem fila externa.

### `fakeProvider.js` (comportamento real)

- `sendMessage({ to, body })` resolve `{ providerMessageId: "pm_" + uuid }`.
- `to` ou `body` não string, ou `body` vazio → erro `status 400`, `invalid_payload`.
- `to` terminando em `0000` → `400`, `invalid_number`.
- Fração aleatória `FAKE_FAIL_RATE` (padrão `0.2`) → `503`, `provider_unavailable`.
- Latência aleatória de 50 a 200 ms.
- **Não emite webhooks.** `delivered`, `read` e falha após aceite chegam só via `POST /webhooks/provider`.

---

## 2. Contrato da API

### `POST /campaigns`

Body: `{ "template": "Olá {{nome}}", "contacts": [{ "phone": "5511999998888", "variables": { "nome": "Ana" } }] }`. Sem campo de nome da campanha.

- **201:** `{ "id": 1, "accepted": 1, "rejected": [{ "phone": "...", "reason": "duplicate" }] }`
- `contacts` vazio → **400**. Body malformado → **400**. Só nesses casos a requisição inteira é rejeitada.
- Se todos os contatos forem rejeitados, a campanha **é criada** com `accepted: 0`.
- Contatos rejeitados **não são persistidos**. O corpo do 201 é o único registro das rejeições de ingestão (ver riscos).
- Contatos não podem ser adicionados nem editados depois do create.

### `POST /campaigns/:id/start`

- `draft` → **202** `{ "status": "running" }`; o worker pode enviar.
- Já `running` ou `finished` → **202** com o status atual; não reenvia.
- Id desconhecido → **404**.

### `GET /campaigns/:id`

`{ "id", "status", "totals": { "queued", "sent", "delivered", "read", "failed" } }`

- Totais contam só mensagens aceitas; os cinco somam `accepted`.
- Id desconhecido → **404**.

### `GET /campaigns/:id/failures?page=1`

- `page` é 1-based. Tamanho de página fixo em **50**; o cliente não escolhe.
- `{ "items": [{ "phone", "reason" }], "page": 1, "pageSize": 50, "total": 0 }`
- Lista só falhas persistidas de envio/provedor. **Não** inclui rejeições de ingestão.
- Id desconhecido → **404**.

### `POST /webhooks/provider`

Body: `event_id`, `provider_message_id`, `status` (`delivered` | `read` | `failed`); `reason` opcional quando `failed`.

- **200** em `event_id` duplicado (sem mudança de estado).
- **200** em `provider_message_id` desconhecido (ignorado, não armazenado).
- **400** com campo ausente ou `status` fora dos três valores.

---

## 3. Validação na criação

- Normalizar telefone para só dígitos. Aceitar tamanho de 10 a 15 inclusive.
- Termina em `0000`, ou tamanho fora de 10–15 → rejeita com `invalid_number`.
- Telefone normalizado repetido na mesma campanha: mantém o primeiro, rejeita os demais com `duplicate`. O mesmo telefone em outra campanha é permitido.
- Placeholders do template: `{{chave}}` com chave `[A-Za-z0-9_]+`.
- Renderizar o corpo **na aceitação** e persistir o corpo renderizado. Chaves extras em `variables` são ignoradas.
- Placeholder sem chave, ou com valor string vazia → rejeita o contato com `missing_variable`.
- Template sem placeholders não exige `variables`.

---

## 4. Estados e regras

**Campanha:** `draft` | `running` | `finished`.

**Mensagem** (um único estado público): `queued` | `sent` | `delivered` | `read` | `failed`. Não existe estado público `sending`; uma linha reivindicada (em voo) continua contando como `queued`.

| De | Evento | Para |
|----|--------|------|
| — | aceita no create | `queued` |
| `queued` | provedor aceita | `sent` (grava `providerMessageId`) |
| `queued` | provedor 400 | `failed` imediato, sem retry; motivo `invalid_number` ou `invalid_payload` |
| `queued` | provedor 503 | continua `queued`; até 3 retries com atrasos de 200 ms, 800 ms, 2 s; falhando o 3º retry → `failed` com `provider_unavailable` |
| `sent` | webhook `delivered` | `delivered` |
| `delivered` / `read` | webhook `delivered` | no-op (além da idempotência do evento) |
| `sent` / `delivered` | webhook `read` | `read` (não conta também como `delivered`) |
| `sent` / `delivered` / `read` | webhook `failed` | `failed`; motivo = `reason` do body se presente e não vazio, senão `provider_failed` |
| `failed` | qualquer webhook que o faria retroceder | ignorado |

**Campanha vira `finished`** quando está `running` e não há nenhuma mensagem `queued`. Webhooks posteriores (`read`/`delivered`/`failed`) ainda atualizam a mensagem e os totais. `finished` nunca volta a `running`.

---

## 5. Worker (em processo)

- Roda dentro da API. O MySQL é a fonte da verdade. No boot, retoma as linhas ainda `queued` de campanhas `running`.
- Concorrência: no máximo **5** chamadas ao provedor em voo. A espera de um retry **não** ocupa slot nem bloqueia os outros.
- **Claim atômico**, para que dois ticks nunca enviem a mesma linha. Esboço (não é código): reivindicar a linha quando o status é `queued`, não há claim ativo e `next_attempt_at <= agora`. Na tabela lógica isso é a linha em `message_claims` (`claimed_at`).
- Em 503: gravar `next_attempt_at`, incrementar `attempt_count`, liberar o claim. Sem estado público `retrying`.
- Claim com mais de **30 s** é obsoleto e pode ser reivindicado de novo (crash do processo).
- `attempt_count` começa em 0. `next_attempt_at` começa no horário da criação, então a linha já é elegível de imediato.
- Mapeamento dos retries: falha com `attempt_count` 0 → espera 200 ms; 1 → 800 ms; 2 → 2 s; falha com `attempt_count` 3 → `failed`. Total de 4 chamadas no pior caso.

---

## 6. Modelo lógico MySQL

Segue `database-architecture-guidelines.mdc`: PK inteira com identity, categorias em tabelas de lookup (sem status em string), sem colunas anuláveis (fatos opcionais em tabela própria), unicidades documentadas.

| Tabela | Colunas | Unicidade / notas |
|--------|---------|-------------------|
| `campaign_statuses` | `id`, `code` | `code` único. Seed: `draft`, `running`, `finished` |
| `message_statuses` | `id`, `code` | `code` único. Seed: `queued`, `sent`, `delivered`, `read`, `failed` |
| `campaigns` | `id`, `template` (not null), `status_id` FK | Sem coluna de nome |
| `messages` | `id`, `campaign_id` FK, `phone` (dígitos normalizados, not null), `body` (renderizado, not null), `status_id` FK, `attempt_count` (not null, default 0), `next_attempt_at` (not null) | **Único (`campaign_id`, `phone`)** |
| `message_provider_ids` | `id`, `message_id` FK, `provider_message_id` | `message_id` único; `provider_message_id` único. Linha só existe depois que o provedor aceita |
| `message_failures` | `id`, `message_id` FK, `reason` (not null) | `message_id` único. Linha só existe quando o status é `failed` |
| `message_claims` | `id`, `message_id` FK, `claimed_at` (not null) | `message_id` único. Linha só existe enquanto um worker segura a mensagem; removida ao fim da tentativa (sucesso, retry agendado ou falha final). Obsoleto = `claimed_at` > 30 s |
| `webhook_events` | `id`, `event_id`, `message_id` FK | `event_id` único (é o que torna o duplicado um no-op). Inserir só quando o `provider_message_id` casou com uma mensagem |

Fora do modelo: Redis, tabela de fila, tabela de contatos rejeitados.

---

## 7. Passagem por marco (só descrição)

Os oito marcos do escopo permanecem, sem renumerar.

| Marco | Entrega | Observações |
|-------|---------|-------------|
| 1 | Este plano | — |
| 2 | Diagramas de componentes seguindo OCP (Paula / Rafael) | Fora desta tarefa |
| 3 | Componente de interfaces: interfaces (portas), entidades e regras de negócio | Sem I/O. Concentra validação, renderização, máquina de estados e regra de `finished` |
| 4 | Componente controller (Express) | A ordem do usuário põe o controller antes dos testes unitários (ver riscos) |
| 5 | Testes unitários das classes do controller, Jest, portas em memória | — |
| 6 | Requisitos 3, 4, 5, 6: SonarQube, `docker compose up` (API + MySQL + o que Sonar, OpenTelemetry e Sentry precisarem localmente), OpenTelemetry + Sentry, k6 | O Compose pode subir o MySQL aqui; o app só fala com o MySQL depois do Marco 7 |
| 7 | Infraestrutura: repositório MySQL, repositório em memória, adaptador do provedor envolvendo `fakeProvider.js` | É aqui que "mock, sem provedor real" se cumpre. O MySQL do Compose é real; o provedor é o arquivo fake. Testes de integração que precisam de MySQL pertencem a este marco |
| 8 | README (requisito 10): regras de design, motivos, como rodar, exemplos de chamada, o que produção adicionaria (API key, assinatura de webhook, worker separado) | Construir essas peças de produção está fora do escopo |

**Rastreio de requisitos:** 1 (TDD + SOLID) → todos os marcos de código; 2 (Jest unit + integração) → M5 e M7; 3 (Sonar) → M6; 4 (compose) → M6, com app ligado ao MySQL em M7; 5 (OTel + Sentry) → M6; 6 (k6) → M6; 7–9 (Node 18+, TypeScript, MySQL) → M3–M7; 10 (README) → M8.

---

## 8. Riscos e incertezas

- **Rejeições de ingestão só existem na resposta 201.** Não são persistidas nem listáveis depois; se o cliente perder a resposta, perde o relatório.
- **Marco 4 antes do Marco 5** briga com uma leitura estrita de TDD. A ordem do usuário permanece; o risco fica registrado.
- **Compose do Marco 6 pode subir o MySQL antes de o Marco 7 ter o adaptador.** O app não usa o banco nesse intervalo.
- **Webhook sem assinatura.** Declarado como item de produção no README; não será construído.
- **A taxa de 503 é aleatória.** Testes e k6 precisam poder definir `FAKE_FAIL_RATE=0` (e valores altos para exercitar retry).
- **Claim obsoleto de 30 s pode causar envio duplo** se uma chamada ao provedor passar disso. Aceitável com a latência de 50–200 ms do fake; em produção exigiria idempotência no provedor.
- `fakeProvider.js` é CommonJS puro; o adaptador TypeScript do Marco 7 precisará de tipagem/`allowJs` sem editar o arquivo.

---

## 9. Pontos que o plano decidiu além do pedido (para revisão)

- Ordem de validação por contato: `invalid_number` → `missing_variable` → `duplicate`. Duplicidade só é checada contra contatos já **aceitos**; um primeiro contato rejeitado não "segura" o telefone.
- Contato sem `phone` string, ou item que não é objeto, é rejeitado como `invalid_number`; `variables` ausente equivale a `{}`. `template` ausente, não string ou vazio → 400.
- Criação da campanha e das mensagens aceitas numa única transação.
- Campanha iniciada com 0 mensagens aceitas: o `start` responde 202 `running` e a campanha vira `finished` na sequência (regra "running e zero `queued`").
- Erro do provedor com `status` diferente de 400 (inclusive sem `status`) é tratado como transitório (caminho do 503). Erro 400 com mensagem fora de `invalid_number`/`invalid_payload` grava `invalid_payload`.
- `failures` ordenado por `message_id` crescente.
- Webhook: o `event_id` é gravado em `webhook_events` mesmo quando a transição é ignorada (ex.: retrocesso de `failed`); inserção do evento e mudança de estado na mesma transação.
- Após crash, claims antigos só são retomados depois dos 30 s; o boot não apaga claims.
- Intervalo de polling do worker é detalhe do Marco 3 (valor curto, configurável).

---

## Desenho estrutural

Autor: Daniel. Não reabre as seções 1–9 nem cria comportamento novo; só dá forma às regras já travadas. Caminhos abaixo são relativos a `projects/campaign-messages/`.

### 10.1 Direção das dependências

```
domain  ←  ports  ←  application  ←  controller
   ↑          ↑
   └──────────┴──────  infrastructure  (implementa as portas)

main.ts → liga tudo (única raiz de composição)
```

- `src/domain/` não importa nada de fora dele: nem Express, nem MySQL, nem `fakeProvider.js`, nem `ports/`. É só tipos e funções puras.
- `src/ports/` só tem interfaces (e os tipos de entrada/saída delas). Importa apenas `domain/`. Domínio e portas formam o anel interno.
- `src/application/` importa `domain/` e `ports/`. Nenhum import de Express nem de infraestrutura.
- `src/controller/` importa `application/` (e tipos de resultado). Nunca importa `domain/` para decidir regra, nem `infrastructure/`.
- `src/infrastructure/` importa `ports/` e `domain/` (tipos) e implementa as portas. Nada de fora importa `infrastructure/`, exceto `main.ts`.
- `src/main.ts` é o único lugar que faz `new` de adaptadores concretos e injeta nas portas; também é o único que lê variáveis de ambiente (`WORKER_POLL_INTERVAL_MS`, `FAKE_FAIL_RATE` já é lido pelo próprio `fakeProvider.js`).
- Composição, não herança: casos de uso e worker são classes pequenas com dependências no construtor. Sem classe base.

### 10.2 Layout de arquivos

```
fakeProvider.js                      (raiz do projeto, intocado; só o adaptador o requer)
src/
  domain/
    messageStatus.ts                 códigos: queued|sent|delivered|read|failed (as const + tipo)
    campaignStatus.ts                códigos: draft|running|finished
    rules.ts                         constantes: CLAIM_TTL_MS=30_000, PAGE_SIZE=50, PHONE_MIN=10, PHONE_MAX=15
    phone.ts                         normalizePhone, isValidPhone (dígitos, 10–15, não termina em 0000)
    template.ts                      extractPlaceholders, renderTemplate
    createCampaignInput.ts           parseCreateCampaign(raw) → válido | inválido (400); ingestContacts(template, contacts) → { accepted, rejected }; ordem invalid_number → missing_variable → duplicate
    messageTransitions.ts            decideWebhook(current, event) → { next, reason? } | ignorar; marcar sent
    retryPolicy.ts                   RETRY_DELAYS_MS=[200,800,2000]; decideAfterTransient(attemptCount) → retry{delayMs} | failed
    providerFailure.ts               tipo ProviderFailure + ProviderErrorClassifier (ver 10.3)
    campaignFinish.ts                shouldFinish(status, queuedCount)
    webhookEvent.ts                  parseWebhookEvent(raw) → válido | inválido (400)
  ports/
    CampaignRepository.ts            única porta de persistência
    MessageProvider.ts               porta do provedor
    Clock.ts                         now(): Date
  application/
    CreateCampaign.ts
    StartCampaign.ts
    GetCampaign.ts
    ListCampaignFailures.ts
    ApplyProviderWebhook.ts
    FinishCampaignIfDone.ts          sub-orquestrador usado por StartCampaign e pelo worker
    SendWorker.ts                    orquestrador do loop (tick/start/stop, limite de voo)
    ProcessClaimedMessage.ts         uma mensagem: enviar → classificar → gravar resultado
    workerConfig.ts                  WORKER_POLL_INTERVAL_MS_DEFAULT=200, MAX_IN_FLIGHT=5
  controller/
    handlers.ts                      funções sem Express: (entrada simples) → { status, body }
    httpMapping.ts                   resultado de caso de uso → status 201/202/200/400/404
    expressApp.ts                    createApp(useCases): liga rotas aos handlers; sem listen
  infrastructure/
    provider/FakeProviderAdapter.ts
    mysql/MySqlCampaignRepository.ts
    memory/InMemoryCampaignRepository.ts
    system/SystemClock.ts
  main.ts                            raiz de composição + listen + SendWorker.start()
tests/                               (Jest, fora de src/)
```

### 10.3 Portas

Três portas. Uma só para repositório, de propósito: criar campanha com mensagens, aplicar webhook com `event_id` e reivindicar mensagem exigem transação ou atomicidade sobre as mesmas tabelas; dividir em duas portas empurraria a transação para fora do adaptador. A porta `Clock` existe só para o worker e os testes controlarem `next_attempt_at` e o claim de 30 s sem dormir de verdade.

**`MessageProvider`**
- `send({ to, body }): Promise<{ providerMessageId }>`.
- Contrato do erro lançado: objeto com `message` e `status` opcional (o formato do `fakeProvider.js`). Qualquer outra coisa lançada é tratada como transitória.

**`Clock`**
- `now(): Date`.

**`CampaignRepository`** (métodos de intenção; o SQL fica escondido):

| Método | Faz |
|--------|-----|
| `createCampaignWithMessages(template, accepted)` → `campaignId` | Uma transação (seção 9). Mensagens nascem `queued`, `attempt_count` 0, `next_attempt_at` = agora |
| `getSummary(campaignId)` → `{ id, status, totals } \| null` | Dados do `GET`; `null` = 404. Também alimenta `FinishCampaignIfDone` (usa `totals.queued`) |
| `markRunningIfDraft(campaignId)` → `boolean` | `draft`→`running`; `false` se já não era `draft` |
| `markFinished(campaignId)` | `running`→`finished`, condicional |
| `listFailures(campaignId, page, pageSize)` → `{ items, total } \| null` | Por `message_id` crescente; `null` = 404 |
| `claimDue({ now, staleBefore, limit })` → `ClaimedMessage[]` | Atômico. Só mensagens `queued` de campanhas `running`, com `next_attempt_at <= now` e sem claim ou com `claimed_at < staleBefore` |
| `recordSent(messageId, providerMessageId)` | `sent` + `message_provider_ids`; libera claim; mesma transação |
| `recordRetry(messageId, attemptCount, nextAttemptAt)` | Mantém `queued`; libera claim |
| `recordFailed(messageId, reason)` | `failed` + `message_failures`; libera claim |
| `applyWebhookEvent(event, decide)` → `'applied' \| 'duplicate' \| 'unknown_message'` | Uma transação: resolve `provider_message_id`, insere `event_id`, lê o status atual, chama `decide(current)` e grava o resultado. `decide` é a função pura `decideWebhook`; o adaptador não conhece a regra |

`ClaimedMessage` = `{ messageId, campaignId, phone, body, attemptCount }`.

O predicado de elegibilidade do claim é mecanismo de persistência, então cada repositório o implementa. A garantia de que os dois (memória e MySQL) se comportam igual vem de uma suíte de contrato única, rodada contra os dois (ver Marco 7).

### 10.4 Pontos de extensão (OCP)

| Tipo | Como se estende | O que não muda |
|------|-----------------|----------------|
| `MessageProvider` | Novo provedor implementa a porta e é trocado em `main.ts` | `SendWorker`, `ProcessClaimedMessage` |
| `CampaignRepository` | Novo repositório implementa a porta | Todos os casos de uso e o worker |
| `ProviderErrorClassifier` | `(err: unknown) => ProviderFailure`, com `ProviderFailure = { kind: 'permanent', reason: 'invalid_number' \| 'invalid_payload' } \| { kind: 'transient' }`. Injetado em `ProcessClaimedMessage` | Novo código permanente futuro altera só o classificador, nunca o worker |
| `Clock` | Relógio falso nos testes | Regras de tempo |

Mapeamento travado do `ProviderErrorClassifier` padrão (`domain/providerFailure.ts`): `status === 400` → `permanent`, com `reason = message` quando for `invalid_number` ou `invalid_payload`, senão `invalid_payload`; qualquer outro `status`, inclusive ausente ou valor lançado que não é objeto → `transient`.

### 10.5 Quem é dono de cada regra travada

| Regra | Dono |
|-------|------|
| Validação de ingestão e renderização (seção 3) | `domain/phone.ts`, `domain/template.ts`, `domain/createCampaignInput.ts`; chamado por `CreateCampaign` |
| Transições de estado de mensagem (seção 4) | `domain/messageTransitions.ts` (webhook, sent) e `domain/retryPolicy.ts` (503 → retry/failed); `domain/providerFailure.ts` classifica o erro |
| Regra de `finished` | `domain/campaignFinish.ts`; aplicada por `application/FinishCampaignIfDone.ts` depois de `recordSent`/`recordFailed` e depois do `start` (não após `recordRetry`, a mensagem segue `queued`) |
| Cronograma de retry 200 ms / 800 ms / 2 s, depois falha | `domain/retryPolicy.ts`; `ProcessClaimedMessage` calcula `nextAttemptAt = clock.now() + delayMs` |
| Claim e claim obsoleto de 30 s | Constante `CLAIM_TTL_MS` em `domain/rules.ts`; `SendWorker` calcula `staleBefore` e passa a `claimDue`; o repositório executa o predicado atômico |
| Idempotência de webhook por `event_id` | Unicidade em `webhook_events` garantida pelo repositório dentro de `applyWebhookEvent`; `ApplyProviderWebhook` só traduz `'duplicate'`/`'unknown_message'` em sucesso (200) |
| Validação do corpo do webhook (400) | `domain/webhookEvent.ts`; chamado por `ApplyProviderWebhook` |
| Códigos HTTP | `controller/httpMapping.ts`. Mapeia o resultado do caso de uso; não decide regra |

Controller e adaptador MySQL não contêm regra de negócio. O controller só faz parse do JSON e do `:id`/`page`, chama o caso de uso e mapeia o resultado. Casos de uso devolvem uniões discriminadas (`{ kind: 'created', ... } | { kind: 'invalid' }`, `{ kind: 'not_found' }`, etc.), nunca lançam para fluxo normal.

### 10.6 Worker

- `SendWorker`: a cada `WORKER_POLL_INTERVAL_MS` roda `tick()`. O tick calcula `limit = MAX_IN_FLIGHT − emVoo`, chama `claimDue` e dispara `ProcessClaimedMessage` para cada claim sem esperar o fim (o contador de voo sobe e desce). A espera de retry vive em `next_attempt_at`, então não ocupa slot.
- **Intervalo de polling padrão: 200 ms** (`WORKER_POLL_INTERVAL_MS_DEFAULT` em `application/workerConfig.ts`), sobrescrevível pelo construtor; `main.ts` pode lê-lo de `WORKER_POLL_INTERVAL_MS`. `MAX_IN_FLIGHT = 5` (seção 5).
- Retomada no boot: não há código especial. `claimDue` já só pega `queued` de campanhas `running`, então basta o worker começar a girar.
- `ProcessClaimedMessage`: `provider.send` → sucesso: `recordSent` → falha: classifier → `permanent` = `recordFailed`; `transient` = `decideAfterTransient(attemptCount)` → `recordRetry` ou `recordFailed('provider_unavailable')`. Depois chama `FinishCampaignIfDone` quando o resultado foi `sent` ou `failed`.
- Um tick nunca lança: erro inesperado em uma mensagem não derruba o loop (o claim obsoleto de 30 s a recupera).

### 10.7 Adaptador do provedor

`infrastructure/provider/FakeProviderAdapter.ts` implementa `MessageProvider`. Faz `require` de `../../../fakeProvider` (CommonJS) com tipo local `{ sendMessage(args): Promise<{ providerMessageId: string }> }`, sem `.d.ts` e sem editar o arquivo (resolve o risco de tipagem da seção 8). O construtor aceita a função de envio, com `fakeProvider.sendMessage` como padrão, para os testes de integração injetarem substitutos. Só esse arquivo conhece `fakeProvider.js`.

### 10.8 O que cada marco cria

**Marco 3 — interfaces, entidades e regras (sem I/O)**
- `src/domain/`: `messageStatus.ts`, `campaignStatus.ts`, `rules.ts`, `phone.ts`, `template.ts`, `createCampaignInput.ts`, `messageTransitions.ts`, `retryPolicy.ts`, `providerFailure.ts`, `campaignFinish.ts`, `webhookEvent.ts`
- `src/ports/`: `CampaignRepository.ts`, `MessageProvider.ts`, `Clock.ts`
- `src/application/`: `CreateCampaign.ts`, `StartCampaign.ts`, `GetCampaign.ts`, `ListCampaignFailures.ts`, `ApplyProviderWebhook.ts`, `FinishCampaignIfDone.ts`, `ProcessClaimedMessage.ts`, `SendWorker.ts`, `workerConfig.ts`
- Raiz: `package.json`, `tsconfig.json` e `jest.config.*` mínimos, se ainda não existirem.

**Marco 4 — controller**
- `src/controller/`: `handlers.ts`, `httpMapping.ts`, `expressApp.ts`
- `createApp(useCases)` não chama `listen`; `main.ts` fica para o Marco 7.

**Marco 5 — testes do controller (não escritos aqui)**
- `tests/controller/`: testes de `handlers.ts` e `httpMapping.ts` chamando os casos de uso reais sobre portas em memória e `MessageProvider`/`Clock` falsos. Cobrem 201/202/200/400/404 e o corpo de cada resposta. As funções de `handlers.ts` não dependem de Express, então não precisa de biblioteca HTTP além de Express e Jest.
- Dependência: esses testes precisam de um `CampaignRepository` em memória antes do Marco 7. Recomendação: construir `InMemoryCampaignRepository` já no Marco 5 (uma só implementação, sem duplicar) e o Marco 7 o formaliza com a suíte de contrato. Se o tech lead preferir manter a lista do Marco 7 literal, o Marco 5 usa dublês descartáveis em `tests/doubles/`, ao custo de duplicar a lógica de claim e de webhook.

**Marco 7 — infraestrutura**
- `src/infrastructure/provider/FakeProviderAdapter.ts`
- `src/infrastructure/mysql/MySqlCampaignRepository.ts` (+ SQL de criação das oito tabelas e seeds dos lookups, onde o plano de schema do Marco 7 decidir)
- `src/infrastructure/memory/InMemoryCampaignRepository.ts` (ou formalização, se vier do Marco 5)
- `src/infrastructure/system/SystemClock.ts`
- `src/main.ts` (raiz de composição, `listen`, `SendWorker.start()`)
- `tests/contract/campaignRepository.contract.ts`: uma suíte rodada contra memória e MySQL (claim atômico, claim obsoleto, idempotência do `event_id`, retrocesso de `failed` ignorado, unicidade `campaign_id + phone`)
- Testes de integração MySQL e do adaptador do provedor (com `FAKE_FAIL_RATE` controlado).

### 10.9 Restrições respeitadas

Sem autenticação, sem Redis, sem segundo processo, sem armazém de contatos rejeitados, sem estado público `sending`/`retrying`. Chaves inteiras com identity e as oito tabelas lógicas da seção 6 permanecem. Nenhum framework além de Express, Jest e MySQL.

### 10.10 Ponto em aberto para o tech lead

`GET /campaigns/:id/failures?page=` com `page` inválido (`0`, negativo, não numérico, ausente) não está definido nas seções 2–9. Proposta mínima, sem comportamento novo no contrato: ausente = `1`; inválido = **400**, decidido por `parsePage` em `domain/rules.ts`. Precisa de confirmação antes do Marco 3.
