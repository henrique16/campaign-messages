export const RETRY_DELAYS_MS: readonly number[] = [200, 800, 2000]

export const RETRY_EXHAUSTED_REASON = 'provider_unavailable'

export type RetryDecision = { kind: 'retry'; delayMs: number } | { kind: 'failed' }

export type RetryPolicy = (attemptCount: number) => RetryDecision

/**
 * Decide o que fazer após falha transitória: tentativas 0, 1 e 2 reagendam com
 * atraso de 200, 800 e 2000 ms; a partir de 3 a mensagem falha.
 * @param attemptCount Quantas tentativas falhas já foram gravadas.
 */
export function decideAfterTransient(attemptCount: number): RetryDecision {
  const delayMs = RETRY_DELAYS_MS[attemptCount]
  return delayMs === undefined ? { kind: 'failed' } : { kind: 'retry', delayMs }
}
