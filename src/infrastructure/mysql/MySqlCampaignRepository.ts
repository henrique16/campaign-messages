import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { CAMPAIGN_STATUS } from '../../domain/campaignStatus'
import type { CampaignStatus } from '../../domain/campaignStatus'
import type { AcceptedContact } from '../../domain/createCampaignInput'
import { MESSAGE_STATUS } from '../../domain/messageStatus'
import type { MessageStatus } from '../../domain/messageStatus'
import type { WebhookDecision } from '../../domain/messageTransitions'
import type { WebhookEvent } from '../../domain/webhookEvent'
import type {
  CampaignRepository,
  CampaignSummary,
  CampaignTotals,
  ClaimDueInput,
  ClaimedMessage,
  FailurePage,
  StartResult,
  WebhookApplyResult,
  WebhookDecider,
} from '../../ports/campaignRepository'

/** Quem executa `CALL`: o pool (procedure autônoma) ou uma conexão presa (transação do webhook). */
type Executor = Pick<Pool, 'query'>

/** Um result set por `SELECT` da procedure, na ordem em que foram emitidos. */
type ResultSets = RowDataPacket[][]

/**
 * Formata a data como UTC `YYYY-MM-DD HH:mm:ss.SSS` (milissegundos), sem depender do driver para fuso.
 * @param date Instante a enviar ao MySQL.
 */
function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

/**
 * Converte o valor lido em id/contagem e rejeita o que não for inteiro seguro.
 * @param value Valor cru da coluna.
 * @param label Nome da coluna, só para a mensagem de erro.
 */
function toSafeInt(value: unknown, label: string): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new Error(`MySqlCampaignRepository: ${label} is not a safe integer`)
  return n
}

/**
 * Valida que o código lido da procedure é um status de campanha conhecido.
 * @param value Valor cru da coluna `status`.
 */
function toCampaignStatus(value: unknown): CampaignStatus {
  const status = Object.values(CAMPAIGN_STATUS).find((known) => known === value)
  if (status === undefined) throw new Error('MySqlCampaignRepository: unknown campaign status')
  return status
}

/**
 * Valida que o código lido da procedure é um status de mensagem conhecido.
 * @param value Valor cru da coluna `current_status`.
 */
function toMessageStatus(value: unknown): MessageStatus {
  const status = Object.values(MESSAGE_STATUS).find((known) => known === value)
  if (status === undefined) throw new Error('MySqlCampaignRepository: unknown message status')
  return status
}

/**
 * Executa `CALL <procedure>(...)` e desembrulha o resultado aninhado do mysql2:
 * mantém só os result sets (arrays) e descarta o `ResultSetHeader` final. Procedure sem
 * `SELECT` devolve `[]`.
 * @param executor Pool ou conexão que roda o `CALL`.
 * @param procedure Nome da procedure (constante do código, nunca entrada do usuário).
 * @param params Argumentos, na ordem da procedure.
 */
async function call(executor: Executor, procedure: string, params: readonly unknown[]): Promise<ResultSets> {
  const placeholders = params.map(() => '?').join(', ')
  const [raw] = await executor.query<RowDataPacket[][] | ResultSetHeader>(
    `CALL ${procedure}(${placeholders})`,
    params as unknown[],
  )
  return Array.isArray(raw) ? raw.filter((entry): entry is RowDataPacket[] => Array.isArray(entry)) : []
}

/**
 * Devolve a única linha do primeiro result set, ou `undefined` quando não houve linha.
 * @param sets Result sets de `call`.
 */
function firstRow(sets: ResultSets): RowDataPacket | undefined {
  return sets[0]?.[0]
}

/**
 * Persistência em MySQL exclusivamente por stored procedures: só emite `CALL`, nunca
 * `SELECT`/`INSERT`/`UPDATE`/`DELETE`. Só `applyWebhookEvent` segura uma conexão e uma transação.
 */
export class MySqlCampaignRepository implements CampaignRepository {
  /**
   * @param pool Pool `mysql2/promise` (fuso `Z`).
   */
  constructor(private readonly pool: Pool) {}

  /**
   * Cria a campanha e as mensagens aceitas numa única chamada; lista vazia também cria a campanha.
   * @param template Template já validado.
   * @param accepted Contatos aceitos, enviados como JSON `[{ phone, body }]`.
   */
  async createCampaignWithMessages(template: string, accepted: readonly AcceptedContact[]): Promise<number> {
    const contactsJson = JSON.stringify(accepted.map(({ phone, body }) => ({ phone, body })))
    const row = firstRow(await call(this.pool, 'create_campaign_with_messages', [template, contactsJson]))
    if (row === undefined) throw new Error('create_campaign_with_messages returned no row')
    return toSafeInt(row.campaign_id, 'campaign_id')
  }

  /**
   * Resumo da campanha; sem linha significa que ela não existe.
   * @param campaignId Campanha consultada.
   */
  async getSummary(campaignId: number): Promise<CampaignSummary | null> {
    const row = firstRow(await call(this.pool, 'get_campaign_summary', [toSafeInt(campaignId, 'campaignId')]))
    if (row === undefined) return null
    const totals: CampaignTotals = {
      queued: toSafeInt(row.queued, 'queued'),
      sent: toSafeInt(row.sent, 'sent'),
      delivered: toSafeInt(row.delivered, 'delivered'),
      read: toSafeInt(row.read, 'read'),
      failed: toSafeInt(row.failed, 'failed'),
    }
    return { id: toSafeInt(row.id, 'id'), status: toCampaignStatus(row.status), totals }
  }

  /**
   * Página de falhas: o primeiro result set traz `{ found, total }`, o segundo `{ phone, reason }`.
   * @param campaignId Campanha consultada.
   * @param page Página (base 1).
   * @param pageSize Itens por página.
   * @returns `null` quando a campanha não existe.
   */
  async listFailures(campaignId: number, page: number, pageSize: number): Promise<FailurePage | null> {
    const sets = await call(this.pool, 'list_campaign_failures', [
      toSafeInt(campaignId, 'campaignId'),
      toSafeInt(page, 'page'),
      toSafeInt(pageSize, 'pageSize'),
    ])
    const head = firstRow(sets)
    if (head === undefined || toSafeInt(head.found, 'found') === 0) return null
    const items = (sets[1] ?? []).map((row) => ({ phone: String(row.phone), reason: String(row.reason) }))
    return { items, total: toSafeInt(head.total, 'total') }
  }

  /**
   * Passa `draft` para `running` e traduz `{ outcome, status }` para `StartResult`.
   * @param campaignId Campanha a iniciar.
   */
  async markRunningIfDraft(campaignId: number): Promise<StartResult> {
    const row = firstRow(await call(this.pool, 'mark_running_if_draft', [toSafeInt(campaignId, 'campaignId')]))
    if (row === undefined) throw new Error('mark_running_if_draft returned no row')
    if (row.outcome === 'started') return { kind: 'started' }
    if (row.outcome === 'not_found') return { kind: 'not_found' }
    if (row.outcome === 'unchanged' && (row.status === 'running' || row.status === 'finished')) {
      return { kind: 'unchanged', status: row.status }
    }
    throw new Error('mark_running_if_draft returned an unexpected outcome')
  }

  /**
   * Passa `running` para `finished`; a procedure é condicional.
   * @param campaignId Campanha a encerrar.
   */
  async markFinished(campaignId: number): Promise<void> {
    await call(this.pool, 'mark_finished', [toSafeInt(campaignId, 'campaignId')])
  }

  /**
   * Reivindica até `limit` mensagens elegíveis; `now` e `staleBefore` vão em UTC com milissegundos.
   * @param input Instante atual, corte do claim obsoleto e limite.
   */
  async claimDue(input: ClaimDueInput): Promise<ClaimedMessage[]> {
    const sets = await call(this.pool, 'claim_due', [
      formatUtc(input.now),
      formatUtc(input.staleBefore),
      toSafeInt(input.limit, 'limit'),
    ])
    return (sets[0] ?? []).map((row) => ({
      messageId: toSafeInt(row.message_id, 'message_id'),
      campaignId: toSafeInt(row.campaign_id, 'campaign_id'),
      phone: String(row.phone),
      body: String(row.body),
      attemptCount: toSafeInt(row.attempt_count, 'attempt_count'),
    }))
  }

  /**
   * Grava `sent` e o id do provedor; a procedure ignora mensagem que não está `queued`.
   * @param messageId Mensagem enviada.
   * @param providerMessageId Id devolvido pelo provedor.
   */
  async recordSent(messageId: number, providerMessageId: string): Promise<void> {
    await call(this.pool, 'record_sent', [toSafeInt(messageId, 'messageId'), providerMessageId])
  }

  /**
   * Mantém `queued` com nova tentativa e horário; a procedure ignora mensagem que não está `queued`.
   * @param messageId Mensagem a reagendar.
   * @param attemptCount Tentativas já gravadas.
   * @param nextAttemptAt Próximo horário, enviado em UTC com milissegundos.
   */
  async recordRetry(messageId: number, attemptCount: number, nextAttemptAt: Date): Promise<void> {
    await call(this.pool, 'record_retry', [
      toSafeInt(messageId, 'messageId'),
      toSafeInt(attemptCount, 'attemptCount'),
      formatUtc(nextAttemptAt),
    ])
  }

  /**
   * Grava `failed` com o motivo; a procedure ignora mensagem que não está `queued`.
   * @param messageId Mensagem que falhou.
   * @param reason Motivo da falha.
   */
  async recordFailed(messageId: number, reason: string): Promise<void> {
    await call(this.pool, 'record_failed', [toSafeInt(messageId, 'messageId'), reason])
  }

  /**
   * Aplica o evento de forma idempotente. É o único método com transação: `decide` é TypeScript e
   * precisa rodar enquanto o lock de linha de `webhook_open` ainda está preso, então `webhook_open`,
   * `decide` e `webhook_apply` usam a mesma conexão entre `beginTransaction` e `commit`/`rollback`.
   * `unknown` e `duplicate` fazem rollback; qualquer exceção faz rollback e é relançada.
   * A conexão sempre volta ao pool.
   * @param event Evento já validado.
   * @param decide Função de domínio chamada com o estado atual da mensagem.
   */
  async applyWebhookEvent(event: WebhookEvent, decide: WebhookDecider): Promise<WebhookApplyResult> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      try {
        const result = await this.openAndApply(connection, event, decide)
        if (result === 'applied') await connection.commit()
        else await connection.rollback()
        return result
      } catch (err) {
        await connection.rollback().catch(() => undefined)
        throw err
      }
    } finally {
      connection.release()
    }
  }

  /**
   * Corpo da transação do webhook: `webhook_open`, decisão de domínio e `webhook_apply`.
   * Não faz commit nem rollback; quem chama decide pelo resultado.
   * @param connection Conexão com a transação já aberta.
   * @param event Evento já validado.
   * @param decide Função de domínio chamada com o estado atual da mensagem.
   */
  private async openAndApply(
    connection: PoolConnection,
    event: WebhookEvent,
    decide: WebhookDecider,
  ): Promise<WebhookApplyResult> {
    const opened = firstRow(await call(connection, 'webhook_open', [event.eventId, event.providerMessageId]))
    if (opened === undefined) throw new Error('webhook_open returned no row')
    if (opened.outcome === 'unknown') return 'unknown_message'
    if (opened.outcome === 'duplicate') return 'duplicate'
    if (opened.outcome !== 'open') throw new Error('webhook_open returned an unexpected outcome')

    const messageId = toSafeInt(opened.message_id, 'message_id')
    const decision = decide(toMessageStatus(opened.current_status))
    const [action, nextStatus, reason] = toApplyArgs(decision)
    const applied = firstRow(await call(connection, 'webhook_apply', [messageId, event.eventId, action, nextStatus, reason]))
    if (applied === undefined) throw new Error('webhook_apply returned no row')
    if (applied.outcome === 'duplicate') return 'duplicate'
    if (applied.outcome !== 'applied') throw new Error('webhook_apply returned an unexpected outcome')
    return 'applied'
  }
}

/**
 * Traduz a decisão de domínio para os argumentos `action`, `next_status` e `reason` de `webhook_apply`.
 * `ignore` manda `''` nos dois últimos; `delivered`/`read` mandam reason `''`; `failed` manda o motivo.
 * @param decision Decisão devolvida por `decide`.
 */
function toApplyArgs(decision: WebhookDecision): [action: string, nextStatus: string, reason: string] {
  if (decision.kind === 'ignore') return ['ignore', '', '']
  return ['apply', decision.next, decision.next === 'failed' ? decision.reason : '']
}
