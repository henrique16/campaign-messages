import { MESSAGE_STATUS } from '../../../src/domain/messageStatus'
import type { MessageStatus } from '../../../src/domain/messageStatus'
import { DEFAULT_WEBHOOK_FAILURE_REASON, decideWebhook } from '../../../src/domain/messageTransitions'
import type { WebhookEvent, WebhookStatus } from '../../../src/domain/webhookEvent'

/**
 * Monta um evento de webhook válido.
 * @param status Status do evento.
 * @param reason Motivo; vazio por padrão.
 */
function event(status: WebhookStatus, reason: string = ''): WebhookEvent {
  return { eventId: 'evt-1', providerMessageId: 'prov-1', status, reason }
}

const ALL: MessageStatus[] = [
  MESSAGE_STATUS.queued,
  MESSAGE_STATUS.sent,
  MESSAGE_STATUS.delivered,
  MESSAGE_STATUS.read,
  MESSAGE_STATUS.failed,
]

describe('decideWebhook', () => {
  it('constante do motivo padrão é provider_failed', () => {
    expect(DEFAULT_WEBHOOK_FAILURE_REASON).toBe('provider_failed')
  })

  describe('evento delivered', () => {
    it('aplica delivered a partir de sent', () => {
      expect(decideWebhook('sent', event('delivered'))).toEqual({ kind: 'apply', next: 'delivered' })
    })

    it.each(ALL.filter((s) => s !== 'sent'))('ignora delivered a partir de %s', (current) => {
      expect(decideWebhook(current, event('delivered'))).toEqual({ kind: 'ignore' })
    })
  })

  describe('evento read', () => {
    it.each(['sent', 'delivered'] as const)('aplica read a partir de %s', (current) => {
      expect(decideWebhook(current, event('read'))).toEqual({ kind: 'apply', next: 'read' })
    })

    it.each(ALL.filter((s) => s !== 'sent' && s !== 'delivered'))('ignora read a partir de %s', (current) => {
      expect(decideWebhook(current, event('read'))).toEqual({ kind: 'ignore' })
    })
  })

  describe('evento failed', () => {
    it.each(['sent', 'delivered', 'read'] as const)('aplica failed a partir de %s com o motivo do evento', (current) => {
      expect(decideWebhook(current, event('failed', 'blocked'))).toEqual({
        kind: 'apply',
        next: 'failed',
        reason: 'blocked',
      })
    })

    it('usa provider_failed quando o motivo do evento é vazio', () => {
      expect(decideWebhook('sent', event('failed', ''))).toEqual({
        kind: 'apply',
        next: 'failed',
        reason: 'provider_failed',
      })
    })

    it.each(['queued', 'failed'] as const)('ignora failed a partir de %s', (current) => {
      expect(decideWebhook(current, event('failed', 'blocked'))).toEqual({ kind: 'ignore' })
    })
  })

  it('ignora qualquer evento vindo de queued', () => {
    for (const status of ['delivered', 'read', 'failed'] as const) {
      expect(decideWebhook('queued', event(status))).toEqual({ kind: 'ignore' })
    }
  })

  it('ignora movimentos para trás (read -> delivered, delivered -> delivered)', () => {
    expect(decideWebhook('read', event('delivered'))).toEqual({ kind: 'ignore' })
    expect(decideWebhook('delivered', event('delivered'))).toEqual({ kind: 'ignore' })
    expect(decideWebhook('read', event('read'))).toEqual({ kind: 'ignore' })
  })
})
