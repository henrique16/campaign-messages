import { CLAIM_TTL_MS, PAGE_SIZE, PHONE_MAX, PHONE_MIN, parsePage } from '../../../src/domain/rules'

describe('constantes de rules', () => {
  it('expõe os limites do marco', () => {
    expect(CLAIM_TTL_MS).toBe(30_000)
    expect(PAGE_SIZE).toBe(50)
    expect(PHONE_MIN).toBe(10)
    expect(PHONE_MAX).toBe(15)
  })
})

describe('parsePage', () => {
  it('vale 1 quando o valor é undefined', () => {
    expect(parsePage(undefined)).toEqual({ kind: 'page', page: 1 })
  })

  it('aceita número inteiro positivo', () => {
    expect(parsePage(1)).toEqual({ kind: 'page', page: 1 })
    expect(parsePage(3)).toEqual({ kind: 'page', page: 3 })
  })

  it('aceita string só de dígitos', () => {
    expect(parsePage('2')).toEqual({ kind: 'page', page: 2 })
    expect(parsePage('007')).toEqual({ kind: 'page', page: 7 })
  })

  it.each([[0], ['0'], [-1], ['-1']])('rejeita zero e negativo (%p)', (raw) => {
    expect(parsePage(raw)).toEqual({ kind: 'invalid' })
  })

  it.each([[1.5], ['1.5'], [NaN], [Infinity]])('rejeita não inteiro (%p)', (raw) => {
    expect(parsePage(raw)).toEqual({ kind: 'invalid' })
  })

  it.each([['abc'], [''], ['1e3'], [' 1'], [null], [true], [{}], [[]], [['1']]])(
    'rejeita valor não numérico (%p)',
    (raw) => {
      expect(parsePage(raw)).toEqual({ kind: 'invalid' })
    },
  )
})
