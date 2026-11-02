import { createPool } from 'mysql2/promise'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { AcceptedContact } from '../../src/domain/createCampaignInput'
import type { MessageStatus } from '../../src/domain/messageStatus'
import { MySqlCampaignRepository } from '../../src/infrastructure/mysql/MySqlCampaignRepository'

/**
 * Instante usado como `now` do `claimDue`: muito no futuro, para que o `next_attempt_at`
 * gravado pelo banco na criação (`UTC_TIMESTAMP(3)`) seja sempre `<=` a ele, sem depender de relógio do host.
 */
export const NOW = new Date('2100-01-01T00:00:00.000Z')

/** `staleBefore` muito no passado: nenhum claim feito em `NOW` é considerado obsoleto. */
export const STALE_PAST = new Date('2000-01-01T00:00:00.000Z')

/** Id que não existe em nenhuma tabela após a limpeza. */
export const MISSING_ID = 999_999_999

/** Ordem de limpeza compatível com as FKs; as tabelas de lookup nunca entram aqui. */
const CLEANUP_ORDER = [
  'webhook_events',
  'message_failures',
  'message_claims',
  'message_provider_ids',
  'messages',
  'campaigns',
] as const

type CountableTable = (typeof CLEANUP_ORDER)[number]

/** Estado de uma mensagem lido direto da tabela, para conferir o que a procedure gravou. */
export type MessageRow = { status: MessageStatus; attemptCount: number; nextAttemptAt: Date }

/**
 * Cria o pool `mysql2/promise` apontando para o MySQL do `docker-compose.yml` (fuso `Z`).
 * Variáveis: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`.
 * Não verifica a conexão: MySQL fora do ar faz os testes falharem, nunca serem pulados.
 */
export function createTestPool(): Pool {
  return createPool({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'campaign',
    password: process.env.MYSQL_PASSWORD ?? 'campaign',
    database: process.env.MYSQL_DATABASE ?? 'campaign_messages',
    timezone: 'Z',
    connectionLimit: 10,
  })
}

/**
 * Apaga as linhas das tabelas de dados, uma a uma e na ordem das FKs.
 * @param pool Pool de teste.
 */
export async function clearAllTables(pool: Pool): Promise<void> {
  for (const table of CLEANUP_ORDER) {
    await pool.query(`DELETE FROM ${table}`)
  }
}

/**
 * Conta as linhas de uma tabela de dados.
 * @param pool Pool de teste.
 * @param table Tabela (lista fechada, nunca entrada externa).
 */
export async function countRows(pool: Pool, table: CountableTable): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${table}`)
  return Number(rows[0]?.total)
}

/**
 * Lê status, tentativas e próximo horário de uma mensagem direto das tabelas.
 * @param pool Pool de teste.
 * @param messageId Mensagem lida.
 */
export async function readMessage(pool: Pool, messageId: number): Promise<MessageRow> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ms.code AS status, m.attempt_count AS attemptCount, m.next_attempt_at AS nextAttemptAt
     FROM messages m
     JOIN message_statuses ms ON ms.id = m.status_id
     WHERE m.id = ?`,
    [messageId],
  )
  const row = rows[0]
  if (row === undefined) throw new Error(`message ${messageId} not found`)
  return {
    status: row.status as MessageStatus,
    attemptCount: Number(row.attemptCount),
    nextAttemptAt: row.nextAttemptAt as Date,
  }
}

/**
 * Telefone válido (11 dígitos) e único por `index`.
 * @param index Número sequencial a partir de 1.
 */
export function phone(index: number): string {
  return `55119${String(index).padStart(6, '0')}`
}

/**
 * Gera contatos aceitos com telefones distintos.
 * @param count Quantidade de contatos.
 * @param first Índice do primeiro telefone.
 */
export function contacts(count: number, first = 1): AcceptedContact[] {
  return Array.from({ length: count }, (_, i) => ({ phone: phone(first + i), body: `Hello ${first + i}` }))
}

/**
 * Cria a campanha, inicia (`running`) e devolve o id.
 * @param repository Repositório real.
 * @param accepted Contatos da campanha.
 */
export async function createRunningCampaign(
  repository: MySqlCampaignRepository,
  accepted: readonly AcceptedContact[],
): Promise<number> {
  const campaignId = await repository.createCampaignWithMessages('Hi {{name}}', accepted)
  const started = await repository.markRunningIfDraft(campaignId)
  if (started.kind !== 'started') throw new Error('test setup: campaign did not start')
  return campaignId
}

/**
 * Cria e inicia uma campanha com um contato, reivindica a mensagem e a grava como `sent`.
 * @param repository Repositório real.
 * @param providerMessageId Id do provedor gravado para a mensagem.
 * @returns Ids da campanha e da mensagem.
 */
export async function createSentMessage(
  repository: MySqlCampaignRepository,
  providerMessageId: string,
): Promise<{ campaignId: number; messageId: number }> {
  const campaignId = await createRunningCampaign(repository, contacts(1))
  const [claimed] = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 1 })
  if (claimed === undefined) throw new Error('test setup: nothing claimed')
  await repository.recordSent(claimed.messageId, providerMessageId)
  return { campaignId, messageId: claimed.messageId }
}
