import { CAMPAIGN_STATUS } from '../../../src/domain/campaignStatus'
import { MESSAGE_STATUS } from '../../../src/domain/messageStatus'

describe('CAMPAIGN_STATUS', () => {
  it('define os códigos draft, running e finished', () => {
    expect(CAMPAIGN_STATUS).toEqual({ draft: 'draft', running: 'running', finished: 'finished' })
  })
})

describe('MESSAGE_STATUS', () => {
  it('define os códigos queued, sent, delivered, read e failed', () => {
    expect(MESSAGE_STATUS).toEqual({
      queued: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      read: 'read',
      failed: 'failed',
    })
  })
})
