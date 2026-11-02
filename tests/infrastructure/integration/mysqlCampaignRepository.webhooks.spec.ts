import type { Pool } from 'mysql2/promise'
import { decideWebhook } from '../../../src/domain/messageTransitions'
import type { WebhookEvent } from '../../../src/domain/webhookEvent'
import { MySqlCampaignRepository } from '../../../src/infrastructure/mysql/MySqlCampaignRepository'
import type { WebhookApplyResult } from '../../../src/ports/campaignRepository'
import { clearAllTables, countRows, createSentMessage, createTestPool, readMessage } from '../../helpers/mysqlTestDb'

const PROVIDER_ID = 'pm_webhook_1'

/**
 * Monta um evento de webhook válido.
 * @param overrides Campos que mudam em relação ao padrão (`delivered` do `PROVIDER_ID`).
 */
function event(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return { eventId: 'evt_1', providerMessageId: PROVIDER_ID, status: 'delivered', reason: '', ...overrides }
}

describe('MySqlCampaignRepository.applyWebhookEvent with the real decideWebhook (real MySQL)', () => {
  let pool: Pool
  let repository: MySqlCampaignRepository

  /**
   * Aplica o evento usando o `decideWebhook` real como decider.
   * @param webhook Evento já validado.
   */
  function apply(webhook: WebhookEvent): Promise<WebhookApplyResult> {
    return repository.applyWebhookEvent(webhook, (current) => decideWebhook(current, webhook))
  }

  beforeAll(() => {
    pool = createTestPool()
    repository = new MySqlCampaignRepository(pool)
  })

  beforeEach(async () => {
    await clearAllTables(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('answers unknown_message for an unknown providerMessageId and leaves the summary unchanged', async () => {
    const { campaignId } = await createSentMessage(repository, PROVIDER_ID)
    const before = await repository.getSummary(campaignId)

    const result = await apply(event({ providerMessageId: 'pm_does_not_exist' }))

    expect(result).toBe('unknown_message')
    expect(await repository.getSummary(campaignId)).toEqual(before)
    expect(before?.totals.sent).toBe(1)
    expect(await countRows(pool, 'webhook_events')).toBe(0)
  })

  it('moves a sent message to delivered and does not also count it as sent', async () => {
    const { campaignId } = await createSentMessage(repository, PROVIDER_ID)

    const result = await apply(event({ status: 'delivered' }))

    expect(result).toBe('applied')
    expect((await repository.getSummary(campaignId))?.totals).toEqual({
      queued: 0,
      sent: 0,
      delivered: 1,
      read: 0,
      failed: 0,
    })
  })

  it('answers duplicate for the same eventId and keeps the totals unchanged', async () => {
    const { campaignId } = await createSentMessage(repository, PROVIDER_ID)
    await apply(event({ status: 'delivered' }))
    const afterFirst = await repository.getSummary(campaignId)

    const result = await apply(event({ status: 'delivered' }))

    expect(result).toBe('duplicate')
    expect(await repository.getSummary(campaignId)).toEqual(afterFirst)
    expect(await countRows(pool, 'webhook_events')).toBe(1)
  })

  it('counts read as read only, not also as delivered', async () => {
    const { campaignId } = await createSentMessage(repository, PROVIDER_ID)

    const result = await apply(event({ status: 'read' }))

    expect(result).toBe('applied')
    expect((await repository.getSummary(campaignId))?.totals).toEqual({
      queued: 0,
      sent: 0,
      delivered: 0,
      read: 1,
      failed: 0,
    })
  })

  describe('failed, then an event that would move the message back', () => {
    it('ignores the later event: status stays failed and the failure reason remains', async () => {
      const { campaignId, messageId } = await createSentMessage(repository, PROVIDER_ID)
      await apply(event({ eventId: 'evt_failed', status: 'failed', reason: 'carrier_rejected' }))
      expect((await readMessage(pool, messageId)).status).toBe('failed')

      await apply(event({ eventId: 'evt_back', status: 'delivered' }))

      expect((await readMessage(pool, messageId)).status).toBe('failed')
      expect((await repository.getSummary(campaignId))?.totals).toEqual({
        queued: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 1,
      })
      const failures = await repository.listFailures(campaignId, 1, 10)
      expect(failures?.total).toBe(1)
      expect(failures?.items).toHaveLength(1)
      expect(failures?.items[0]?.reason).toBe('carrier_rejected')
    })

    it('still stores the ignored event: repeating its eventId answers duplicate', async () => {
      await createSentMessage(repository, PROVIDER_ID)
      await apply(event({ eventId: 'evt_failed', status: 'failed', reason: 'carrier_rejected' }))
      await apply(event({ eventId: 'evt_back', status: 'delivered' }))
      expect(await countRows(pool, 'webhook_events')).toBe(2)

      const result = await apply(event({ eventId: 'evt_back', status: 'delivered' }))

      expect(result).toBe('duplicate')
      expect(await countRows(pool, 'webhook_events')).toBe(2)
    })
  })
})
