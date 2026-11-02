import { isValidPhone, normalizePhone } from '../../../src/domain/phone'

describe('normalizePhone', () => {
  it('mantém só os dígitos do telefone', () => {
    expect(normalizePhone('+55 (11) 91234-5678')).toBe('5511912345678')
  })

  it('devolve o mesmo valor quando já só tem dígitos', () => {
    expect(normalizePhone('5511912345678')).toBe('5511912345678')
  })

  it('devolve string vazia quando não há nenhum dígito', () => {
    expect(normalizePhone('abc-()')).toBe('')
    expect(normalizePhone('')).toBe('')
  })
})

describe('isValidPhone', () => {
  it('rejeita telefone com 9 dígitos', () => {
    expect(isValidPhone('119123456')).toBe(false)
  })

  it('aceita telefone com 10 dígitos (limite inferior)', () => {
    expect(isValidPhone('1191234567')).toBe(true)
  })

  it('aceita telefone com 15 dígitos (limite superior)', () => {
    expect(isValidPhone('551191234567890')).toBe(true)
  })

  it('rejeita telefone com 16 dígitos', () => {
    expect(isValidPhone('5511912345678901')).toBe(false)
  })

  it('rejeita telefone que termina em 0000', () => {
    expect(isValidPhone('1199990000')).toBe(false)
    expect(isValidPhone('551191230000')).toBe(false)
  })

  it('aceita telefone que termina em 000 mas não em 0000', () => {
    expect(isValidPhone('1199999000')).toBe(true)
  })

  it('rejeita string vazia', () => {
    expect(isValidPhone('')).toBe(false)
  })
})
