import { WEBHOOK_STATUSES, parseWebhookEvent } from '../../../src/domain/webhookEvent'

const base = { event_id: 'evt-1', provider_message_id: 'prov-1' }

describe('WEBHOOK_STATUSES', () => {
  it('lista delivered, read e failed', () => {
    expect([...WEBHOOK_STATUSES]).toEqual(['delivered', 'read', 'failed'])
  })
})

describe('parseWebhookEvent', () => {
  it('aceita delivered com reason vazio', () => {
    expect(parseWebhookEvent({ ...base, status: 'delivered' })).toEqual({
      kind: 'valid',
      event: { eventId: 'evt-1', providerMessageId: 'prov-1', status: 'delivered', reason: '' },
    })
  })

  it('aceita read', () => {
    expect(parseWebhookEvent({ ...base, status: 'read' })).toEqual({
      kind: 'valid',
      event: { eventId: 'evt-1', providerMessageId: 'prov-1', status: 'read', reason: '' },
    })
  })

  it('aceita failed e mantém o reason string', () => {
    expect(parseWebhookEvent({ ...base, status: 'failed', reason: 'blocked' })).toEqual({
      kind: 'valid',
      event: { eventId: 'evt-1', providerMessageId: 'prov-1', status: 'failed', reason: 'blocked' },
    })
  })

  it('aceita failed sem reason e devolve reason vazio', () => {
    const result = parseWebhookEvent({ ...base, status: 'failed' })
    expect(result).toMatchObject({ kind: 'valid', event: { status: 'failed', reason: '' } })
  })

  it('aceita failed com reason que não é string e devolve reason vazio', () => {
    const result = parseWebhookEvent({ ...base, status: 'failed', reason: 42 })
    expect(result).toMatchObject({ kind: 'valid', event: { status: 'failed', reason: '' } })
  })

  it('ignora reason quando o status não é failed', () => {
    const result = parseWebhookEvent({ ...base, status: 'delivered', reason: 'x' })
    expect(result).toMatchObject({ kind: 'valid', event: { status: 'delivered', reason: '' } })
  })

  it.each([[undefined], [null], ['texto'], [5]])('é invalid quando o corpo não é objeto (%p)', (raw) => {
    expect(parseWebhookEvent(raw)).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando falta event_id', () => {
    expect(parseWebhookEvent({ provider_message_id: 'prov-1', status: 'read' })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando event_id é vazio ou não string', () => {
    expect(parseWebhookEvent({ ...base, event_id: '', status: 'read' })).toEqual({ kind: 'invalid' })
    expect(parseWebhookEvent({ ...base, event_id: 1, status: 'read' })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando falta provider_message_id', () => {
    expect(parseWebhookEvent({ event_id: 'evt-1', status: 'read' })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando provider_message_id é vazio ou não string', () => {
    expect(parseWebhookEvent({ ...base, provider_message_id: '', status: 'read' })).toEqual({ kind: 'invalid' })
    expect(parseWebhookEvent({ ...base, provider_message_id: 9, status: 'read' })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando falta status', () => {
    expect(parseWebhookEvent({ ...base })).toEqual({ kind: 'invalid' })
  })

  it.each([['queued'], ['sent'], ['DELIVERED'], [''], [1], [null]])(
    'é invalid quando o status é %p',
    (status) => {
      expect(parseWebhookEvent({ ...base, status })).toEqual({ kind: 'invalid' })
    },
  )
})
