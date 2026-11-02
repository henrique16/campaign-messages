import { ApplyProviderWebhook } from '../../../src/application/ApplyProviderWebhook'
import { FakeProviderWebhookStore } from '../../helpers/fakes'

const validBody = { event_id: 'evt-1', provider_message_id: 'prov-1', status: 'delivered' }

describe('ApplyProviderWebhook', () => {
  it('corpo inválido devolve invalid e não chama a porta', async () => {
    const store = new FakeProviderWebhookStore()
    const result = await new ApplyProviderWebhook(store).execute({ event_id: 'evt-1', status: 'delivered' })
    expect(result).toEqual({ kind: 'invalid' })
    expect(store.calls).toHaveLength(0)
  })

  it('status desconhecido devolve invalid e não chama a porta', async () => {
    const store = new FakeProviderWebhookStore()
    const result = await new ApplyProviderWebhook(store).execute({ ...validBody, status: 'sent' })
    expect(result).toEqual({ kind: 'invalid' })
    expect(store.calls).toHaveLength(0)
  })

  it('corpo válido chama applyWebhookEvent com o evento parseado e devolve ok', async () => {
    const store = new FakeProviderWebhookStore('applied')
    const result = await new ApplyProviderWebhook(store).execute(validBody)
    expect(result).toEqual({ kind: 'ok' })
    expect(store.calls).toHaveLength(1)
    expect(store.calls[0].event).toEqual({
      eventId: 'evt-1',
      providerMessageId: 'prov-1',
      status: 'delivered',
      reason: '',
    })
  })

  it('entrega um decider que aplica decideWebhook com o evento fixado', async () => {
    const store = new FakeProviderWebhookStore()
    await new ApplyProviderWebhook(store).execute(validBody)
    const { decide } = store.calls[0]
    expect(decide('sent')).toEqual({ kind: 'apply', next: 'delivered' })
    expect(decide('queued')).toEqual({ kind: 'ignore' })
    expect(decide('read')).toEqual({ kind: 'ignore' })
  })

  it('o decider de um evento failed usa o motivo do evento', async () => {
    const store = new FakeProviderWebhookStore()
    await new ApplyProviderWebhook(store).execute({ ...validBody, status: 'failed', reason: 'blocked' })
    expect(store.calls[0].decide('sent')).toEqual({ kind: 'apply', next: 'failed', reason: 'blocked' })
  })

  it('resultado duplicate da porta ainda devolve ok', async () => {
    const result = await new ApplyProviderWebhook(new FakeProviderWebhookStore('duplicate')).execute(validBody)
    expect(result).toEqual({ kind: 'ok' })
  })

  it('resultado unknown_message da porta ainda devolve ok', async () => {
    const result = await new ApplyProviderWebhook(new FakeProviderWebhookStore('unknown_message')).execute(
      validBody,
    )
    expect(result).toEqual({ kind: 'ok' })
  })
})
