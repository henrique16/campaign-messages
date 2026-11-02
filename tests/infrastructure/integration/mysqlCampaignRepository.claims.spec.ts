import type { Pool } from 'mysql2/promise'
import { MySqlCampaignRepository } from '../../../src/infrastructure/mysql/MySqlCampaignRepository'
import {
  NOW,
  STALE_PAST,
  clearAllTables,
  contacts,
  countRows,
  createRunningCampaign,
  createTestPool,
  readMessage,
} from '../../helpers/mysqlTestDb'

/**
 * Soma milissegundos a um instante sem alterar o original.
 * @param base Instante de partida.
 * @param ms Milissegundos a somar (pode ser negativo).
 */
function plus(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms)
}

describe('MySqlCampaignRepository — outcomes and claimDue (real MySQL)', () => {
  let pool: Pool
  let repository: MySqlCampaignRepository

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

  describe('recordSent / recordRetry', () => {
    it('recordSent moves the message to sent, stores the provider id and releases the claim', async () => {
      const campaignId = await createRunningCampaign(repository, contacts(1))
      const [claimed] = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 1 })

      await repository.recordSent(claimed.messageId, 'pm_sent_1')

      expect((await readMessage(pool, claimed.messageId)).status).toBe('sent')
      expect((await repository.getSummary(campaignId))?.totals).toEqual({
        queued: 0,
        sent: 1,
        delivered: 0,
        read: 0,
        failed: 0,
      })
      expect(await countRows(pool, 'message_provider_ids')).toBe(1)
      expect(await countRows(pool, 'message_claims')).toBe(0)
      expect(await repository.claimDue({ now: plus(NOW, 1000), staleBefore: STALE_PAST, limit: 5 })).toEqual([])
    })

    it('recordRetry keeps queued, stores attemptCount and nextAttemptAt, and claimDue honors that time', async () => {
      const campaignId = await createRunningCampaign(repository, contacts(1))
      const [claimed] = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 1 })
      const retryAt = plus(NOW, 60_000)

      await repository.recordRetry(claimed.messageId, 1, retryAt)

      const stored = await readMessage(pool, claimed.messageId)
      expect(stored.status).toBe('queued')
      expect(stored.attemptCount).toBe(1)
      expect(stored.nextAttemptAt.getTime()).toBe(retryAt.getTime())
      expect((await repository.getSummary(campaignId))?.totals.queued).toBe(1)

      const tooEarly = await repository.claimDue({ now: plus(retryAt, -1), staleBefore: STALE_PAST, limit: 5 })
      expect(tooEarly).toEqual([])

      const afterTime = await repository.claimDue({ now: plus(retryAt, 1000), staleBefore: STALE_PAST, limit: 5 })
      expect(afterTime).toHaveLength(1)
      expect(afterTime[0]).toMatchObject({ messageId: claimed.messageId, campaignId, attemptCount: 1 })
    })
  })

  describe('claimDue eligibility', () => {
    it('ignores messages of draft campaigns', async () => {
      await repository.createCampaignWithMessages('Hi {{name}}', contacts(2))

      expect(await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 10 })).toEqual([])
      expect(await countRows(pool, 'message_claims')).toBe(0)
    })

    it('ignores messages whose next_attempt_at is in the future and returns the due ones', async () => {
      await createRunningCampaign(repository, contacts(2))
      const [first, second] = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 2 })
      await repository.recordRetry(first.messageId, 1, plus(NOW, 3_600_000))
      await repository.recordRetry(second.messageId, 1, plus(NOW, -1000))

      const due = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 10 })

      expect(due.map((message) => message.messageId)).toEqual([second.messageId])
    })

    it('respects limit and returns the lowest ids first', async () => {
      await createRunningCampaign(repository, contacts(5))

      const firstBatch = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 2 })
      const secondBatch = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 10 })

      expect(firstBatch).toHaveLength(2)
      expect(secondBatch).toHaveLength(3)
      const ids = [...firstBatch, ...secondBatch].map((message) => message.messageId)
      expect(new Set(ids).size).toBe(5)
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
    })
  })

  describe('claimDue concurrency', () => {
    it('never returns the same messageId to two overlapping calls', async () => {
      await createRunningCampaign(repository, contacts(20))

      const [a, b] = await Promise.all([
        repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 20 }),
        repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 20 }),
      ])
      const remaining = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 20 })

      const idsA = a.map((message) => message.messageId)
      const idsB = b.map((message) => message.messageId)
      expect(idsA.filter((id) => idsB.includes(id))).toEqual([])
      expect(idsA.length + idsB.length).toBeGreaterThan(0)
      expect(idsA.length + idsB.length + remaining.length).toBe(20)
    })
  })

  describe('stale claims', () => {
    it('claims again an unreleased claim when staleBefore is after its claimed_at', async () => {
      await createRunningCampaign(repository, contacts(1))
      const [firstClaim] = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 1 })

      const reclaimed = await repository.claimDue({ now: plus(NOW, 1000), staleBefore: plus(NOW, 1), limit: 1 })

      expect(reclaimed.map((message) => message.messageId)).toEqual([firstClaim.messageId])
      expect(await countRows(pool, 'message_claims')).toBe(1)
    })

    it('does not reclaim when staleBefore equals the claim time', async () => {
      await createRunningCampaign(repository, contacts(1))
      await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 1 })

      const again = await repository.claimDue({ now: plus(NOW, 1000), staleBefore: NOW, limit: 1 })

      expect(again).toEqual([])
    })
  })
})
