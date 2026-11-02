export type PermanentReason = 'invalid_number' | 'invalid_payload'

export type ProviderFailure = { kind: 'permanent'; reason: PermanentReason } | { kind: 'transient' }

export type ProviderErrorClassifier = (err: unknown) => ProviderFailure

/**
 * Classificador padrão: `status === 400` é permanente (`invalid_number` quando a
 * mensagem for essa, senão `invalid_payload`); qualquer outra coisa é transitória.
 * @param err Valor lançado pelo provedor.
 */
export function classifyProviderError(err: unknown): ProviderFailure {
  if (typeof err !== 'object' || err === null) return { kind: 'transient' }
  const { status, message } = err as { status?: unknown; message?: unknown }
  if (status !== 400) return { kind: 'transient' }
  return { kind: 'permanent', reason: message === 'invalid_number' ? 'invalid_number' : 'invalid_payload' }
}
