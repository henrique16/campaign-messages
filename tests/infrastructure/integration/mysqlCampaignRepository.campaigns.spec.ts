import type { Pool } from 'mysql2/promise'
import { MySqlCampaignRepository } from '../../../src/infrastructure/mysql/MySqlCampaignRepository'
import {
  MISSING_ID,
  NOW,
  STALE_PAST,
  clearAllTables,
  contacts,
  countRows,
  createRunningCampaign,
  createTestPool,
  phone,
} from '../../helpers/mysqlTestDb'

describe('MySqlCampaignRepository — campaigns, start/finish and failures (real MySQL)', () => {
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

  describe('createCampaignWithMessages / getSummary', () => {
    it('creates a draft campaign and counts every accepted contact as queued', async () => {
      const campaignId = await repository.createCampaignWithMessages('Hi {{name}}', contacts(3))

      expect(await repository.getSummary(campaignId)).toEqual({
        id: campaignId,
        status: 'draft',
        totals: { queued: 3, sent: 0, delivered: 0, read: 0, failed: 0 },
      })
    })

    it('creates the campaign even when the accepted array is empty', async () => {
      const campaignId = await repository.createCampaignWithMessages('Hi {{name}}', [])

      expect(await repository.getSummary(campaignId)).toEqual({
        id: campaignId,
        status: 'draft',
        totals: { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 },
      })
      expect(await countRows(pool, 'messages')).toBe(0)
    })

    it('returns null for a campaign that does not exist', async () => {
      expect(await repository.getSummary(MISSING_ID)).toBeNull()
    })

    it('keeps counting claimed messages as queued', async () => {
      const campaignId = await createRunningCampaign(repository, contacts(3))

      const claimed = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 3 })

      expect(claimed).toHaveLength(3)
      expect((await repository.getSummary(campaignId))?.totals).toEqual({
        queued: 3,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
      })
    })
  })

  describe('unique campaign_id + phone', () => {
    it('rejects the whole call for two identical phones and leaves no campaign behind', async () => {
      const duplicated = [
        { phone: phone(1), body: 'first' },
        { phone: phone(2), body: 'second' },
        { phone: phone(1), body: 'again' },
      ]

      await expect(repository.createCampaignWithMessages('Hi {{name}}', duplicated)).rejects.toMatchObject({
        code: 'ER_DUP_ENTRY',
      })

      expect(await countRows(pool, 'campaigns')).toBe(0)
      expect(await countRows(pool, 'messages')).toBe(0)
    })

    it('allows the same phone in two different campaigns', async () => {
      const first = await repository.createCampaignWithMessages('Hi {{name}}', contacts(1))
      const second = await repository.createCampaignWithMessages('Hi {{name}}', contacts(1))

      expect(second).not.toBe(first)
      expect((await repository.getSummary(first))?.totals.queued).toBe(1)
      expect((await repository.getSummary(second))?.totals.queued).toBe(1)
      expect(await countRows(pool, 'messages')).toBe(2)
    })
  })

  describe('markRunningIfDraft / markFinished', () => {
    it('answers not_found for a missing id', async () => {
      expect(await repository.markRunningIfDraft(MISSING_ID)).toEqual({ kind: 'not_found' })
    })

    it('starts a draft once and reports running on the second call', async () => {
      const campaignId = await repository.createCampaignWithMessages('Hi {{name}}', contacts(1))

      expect(await repository.markRunningIfDraft(campaignId)).toEqual({ kind: 'started' })
      expect((await repository.getSummary(campaignId))?.status).toBe('running')
      expect(await repository.markRunningIfDraft(campaignId)).toEqual({ kind: 'unchanged', status: 'running' })
      expect((await repository.getSummary(campaignId))?.status).toBe('running')
    })

    it('markFinished moves a running campaign to finished', async () => {
      const campaignId = await createRunningCampaign(repository, contacts(1))

      await repository.markFinished(campaignId)

      expect((await repository.getSummary(campaignId))?.status).toBe('finished')
      expect(await repository.markRunningIfDraft(campaignId)).toEqual({ kind: 'unchanged', status: 'finished' })
    })

    it('markFinished leaves a draft campaign as draft', async () => {
      const campaignId = await repository.createCampaignWithMessages('Hi {{name}}', contacts(1))

      await repository.markFinished(campaignId)

      expect((await repository.getSummary(campaignId))?.status).toBe('draft')
    })
  })

  describe('listFailures', () => {
    it('returns null for a missing campaign', async () => {
      expect(await repository.listFailures(MISSING_ID, 1, 10)).toBeNull()
    })

    it('returns an empty page with total 0 for a campaign without failures', async () => {
      const campaignId = await repository.createCampaignWithMessages('Hi {{name}}', contacts(2))

      expect(await repository.listFailures(campaignId, 1, 10)).toEqual({ items: [], total: 0 })
    })

    it('orders the page by message id, honors the page size and returns an empty page past the end', async () => {
      const campaignId = await createRunningCampaign(repository, contacts(5))
      const claimed = await repository.claimDue({ now: NOW, staleBefore: STALE_PAST, limit: 5 })
      expect(claimed).toHaveLength(5)
      const [m1, m2, m3, m4] = claimed
      // Recorded out of id order on purpose: the page must still come ordered by message id.
      await repository.recordFailed(m4.messageId, 'reason_4')
      await repository.recordFailed(m2.messageId, 'reason_2')
      await repository.recordFailed(m3.messageId, 'reason_3')

      const firstPage = await repository.listFailures(campaignId, 1, 2)
      const secondPage = await repository.listFailures(campaignId, 2, 2)
      const pastTheEnd = await repository.listFailures(campaignId, 3, 2)

      expect(firstPage).toEqual({
        items: [
          { phone: m2.phone, reason: 'reason_2' },
          { phone: m3.phone, reason: 'reason_3' },
        ],
        total: 3,
      })
      expect(secondPage).toEqual({ items: [{ phone: m4.phone, reason: 'reason_4' }], total: 3 })
      expect(pastTheEnd).toEqual({ items: [], total: 3 })
      expect(firstPage?.items.map((item) => item.phone)).not.toContain(m1.phone)
      expect(await repository.listFailures(MISSING_ID, 3, 2)).toBeNull()
    })
  })
})
