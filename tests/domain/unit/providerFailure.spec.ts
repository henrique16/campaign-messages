import { classifyProviderError } from '../../../src/domain/providerFailure'

describe('classifyProviderError', () => {
  it('status 400 com message invalid_number é permanente invalid_number', () => {
    expect(classifyProviderError({ status: 400, message: 'invalid_number' })).toEqual({
      kind: 'permanent',
      reason: 'invalid_number',
    })
  })

  it('status 400 com message invalid_payload é permanente invalid_payload', () => {
    expect(classifyProviderError({ status: 400, message: 'invalid_payload' })).toEqual({
      kind: 'permanent',
      reason: 'invalid_payload',
    })
  })

  it('status 400 com qualquer outra message é permanente invalid_payload', () => {
    expect(classifyProviderError({ status: 400, message: 'qualquer coisa' })).toEqual({
      kind: 'permanent',
      reason: 'invalid_payload',
    })
  })

  it('status 400 sem message é permanente invalid_payload', () => {
    expect(classifyProviderError({ status: 400 })).toEqual({ kind: 'permanent', reason: 'invalid_payload' })
  })

  it('objeto sem status é transitório', () => {
    expect(classifyProviderError({ message: 'invalid_number' })).toEqual({ kind: 'transient' })
  })

  it('status diferente de 400 é transitório', () => {
    expect(classifyProviderError({ status: 500, message: 'boom' })).toEqual({ kind: 'transient' })
    expect(classifyProviderError({ status: 429 })).toEqual({ kind: 'transient' })
  })

  it('status "400" como string é transitório', () => {
    expect(classifyProviderError({ status: '400', message: 'invalid_number' })).toEqual({ kind: 'transient' })
  })

  it('Error comum sem status é transitório', () => {
    expect(classifyProviderError(new Error('timeout'))).toEqual({ kind: 'transient' })
  })

  it.each([[null], [undefined], ['erro'], [400], [true]])('valor que não é objeto (%p) é transitório', (err) => {
    expect(classifyProviderError(err)).toEqual({ kind: 'transient' })
  })
})
