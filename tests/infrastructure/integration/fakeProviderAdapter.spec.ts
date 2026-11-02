import type { FakeProviderAdapter } from '../../../src/infrastructure/provider/FakeProviderAdapter'

type ProviderError = Error & { status?: number }

/**
 * Carrega um `FakeProviderAdapter` novo com `FAKE_FAIL_RATE` fixo. `fakeProvider.js` lê a variável
 * uma única vez no carregamento, então o registro de módulos é zerado e o adapter é importado de novo.
 * @param failRate Valor de `FAKE_FAIL_RATE` (`'0'` nunca falha, `'1'` sempre falha).
 */
async function loadAdapter(failRate: string): Promise<FakeProviderAdapter> {
  process.env.FAKE_FAIL_RATE = failRate
  jest.resetModules()
  const { FakeProviderAdapter: Adapter } = await import('../../../src/infrastructure/provider/FakeProviderAdapter')
  return new Adapter()
}

/**
 * Espera a promessa rejeitar e devolve o erro; falha o teste se ela resolver.
 * @param promise Chamada que deve rejeitar.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<ProviderError> {
  const outcome = await promise.then(
    (value) => ({ resolved: true as const, value }),
    (error: unknown) => ({ resolved: false as const, error }),
  )
  if (outcome.resolved) throw new Error(`expected rejection, got ${JSON.stringify(outcome.value)}`)
  expect(outcome.error).toBeInstanceOf(Error)
  return outcome.error as ProviderError
}

describe('FakeProviderAdapter with the real fakeProvider.js', () => {
  const originalFailRate = process.env.FAKE_FAIL_RATE

  afterAll(() => {
    if (originalFailRate === undefined) delete process.env.FAKE_FAIL_RATE
    else process.env.FAKE_FAIL_RATE = originalFailRate
    jest.resetModules()
  })

  describe('FAKE_FAIL_RATE=0', () => {
    let adapter: FakeProviderAdapter

    beforeAll(async () => {
      adapter = await loadAdapter('0')
    })

    it('resolves a normal send with a providerMessageId starting with pm_', async () => {
      const result = await adapter.send({ to: '5511999990001', body: 'Hello' })

      expect(result.providerMessageId).toMatch(/^pm_.+/)
    })

    it('rejects a number ending in 0000 with status 400 and invalid_number', async () => {
      const error = await rejectionOf(adapter.send({ to: '551199990000', body: 'Hello' }))

      expect(error.status).toBe(400)
      expect(error.message).toBe('invalid_number')
    })

    it('rejects an empty body with status 400 and invalid_payload', async () => {
      const error = await rejectionOf(adapter.send({ to: '5511999990001', body: '' }))

      expect(error.status).toBe(400)
      expect(error.message).toBe('invalid_payload')
    })
  })

  describe('FAKE_FAIL_RATE=1', () => {
    it('rejects a normal send with status 503 and provider_unavailable', async () => {
      const adapter = await loadAdapter('1')

      const error = await rejectionOf(adapter.send({ to: '5511999990001', body: 'Hello' }))

      expect(error.status).toBe(503)
      expect(error.message).toBe('provider_unavailable')
    })
  })
})
