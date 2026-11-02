import { RETRY_DELAYS_MS, RETRY_EXHAUSTED_REASON, decideAfterTransient } from '../../../src/domain/retryPolicy'

describe('constantes de retryPolicy', () => {
  it('expõe os atrasos 200, 800 e 2000 ms e o motivo provider_unavailable', () => {
    expect([...RETRY_DELAYS_MS]).toEqual([200, 800, 2000])
    expect(RETRY_EXHAUSTED_REASON).toBe('provider_unavailable')
  })
})

describe('decideAfterTransient', () => {
  it.each([
    [0, 200],
    [1, 800],
    [2, 2000],
  ])('na tentativa %i reagenda com atraso de %i ms', (attemptCount, delayMs) => {
    expect(decideAfterTransient(attemptCount)).toEqual({ kind: 'retry', delayMs })
  })

  it.each([[3], [4], [100]])('a partir da tentativa %i a mensagem falha', (attemptCount) => {
    expect(decideAfterTransient(attemptCount)).toEqual({ kind: 'failed' })
  })
})
