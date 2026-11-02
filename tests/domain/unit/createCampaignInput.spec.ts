import { ingestContacts, parseCreateCampaign } from '../../../src/domain/createCampaignInput'

describe('parseCreateCampaign', () => {
  it.each([[undefined], [null], ['texto'], [5], [[]], [[{ template: 'x' }]]])(
    'é invalid quando o corpo não é objeto simples (%p)',
    (raw) => {
      expect(parseCreateCampaign(raw)).toEqual({ kind: 'invalid' })
    },
  )

  it('é invalid quando falta template', () => {
    expect(parseCreateCampaign({ contacts: [{}] })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando template não é string', () => {
    expect(parseCreateCampaign({ template: 5, contacts: [{}] })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando template é string vazia', () => {
    expect(parseCreateCampaign({ template: '', contacts: [{}] })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando falta contacts', () => {
    expect(parseCreateCampaign({ template: 'Oi' })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando contacts não é array', () => {
    expect(parseCreateCampaign({ template: 'Oi', contacts: { phone: '1' } })).toEqual({ kind: 'invalid' })
  })

  it('é invalid quando contacts é array vazio', () => {
    expect(parseCreateCampaign({ template: 'Oi', contacts: [] })).toEqual({ kind: 'invalid' })
  })

  it('é valid com template string e contacts não vazio, devolvendo ambos', () => {
    const contacts = [{ phone: '5511912345678' }]
    const result = parseCreateCampaign({ template: 'Oi', contacts })
    expect(result).toEqual({ kind: 'valid', template: 'Oi', contacts })
  })
})

describe('ingestContacts', () => {
  it('aceita contato válido com telefone normalizado e corpo renderizado', () => {
    const result = ingestContacts('Olá {{nome}}', [
      { phone: '+55 (11) 91234-5678', variables: { nome: 'Ana' } },
    ])
    expect(result).toEqual({ accepted: [{ phone: '5511912345678', body: 'Olá Ana' }], rejected: [] })
  })

  it('mantém a ordem dos contatos aceitos', () => {
    const result = ingestContacts('Oi', [{ phone: '5511900000001' }, { phone: '5511900000002' }])
    expect(result.accepted.map((c) => c.phone)).toEqual(['5511900000001', '5511900000002'])
  })

  it('rejeita telefone curto como invalid_number, devolvendo o telefone como veio', () => {
    const result = ingestContacts('Oi', [{ phone: '(11) 1234' }])
    expect(result).toEqual({ accepted: [], rejected: [{ phone: '(11) 1234', reason: 'invalid_number' }] })
  })

  it('rejeita telefone longo demais como invalid_number', () => {
    const result = ingestContacts('Oi', [{ phone: '5511912345678901' }])
    expect(result.rejected).toEqual([{ phone: '5511912345678901', reason: 'invalid_number' }])
  })

  it('rejeita telefone que termina em 0000 como invalid_number', () => {
    const result = ingestContacts('Oi', [{ phone: '55119123 0000' }])
    expect(result.rejected).toEqual([{ phone: '55119123 0000', reason: 'invalid_number' }])
  })

  it.each([[null], ['texto'], [5], [[]], [undefined]])(
    'rejeita contato que não é objeto (%p) como invalid_number com telefone vazio',
    (contact) => {
      const result = ingestContacts('Oi', [contact])
      expect(result).toEqual({ accepted: [], rejected: [{ phone: '', reason: 'invalid_number' }] })
    },
  )

  it('rejeita telefone que não é string como invalid_number com telefone vazio', () => {
    const result = ingestContacts('Oi', [{ phone: 5511912345678 }, { variables: {} }])
    expect(result.rejected).toEqual([
      { phone: '', reason: 'invalid_number' },
      { phone: '', reason: 'invalid_number' },
    ])
  })

  it('rejeita variável ausente como missing_variable', () => {
    const result = ingestContacts('Olá {{nome}}', [{ phone: '5511912345678', variables: {} }])
    expect(result).toEqual({ accepted: [], rejected: [{ phone: '5511912345678', reason: 'missing_variable' }] })
  })

  it('rejeita variável vazia ou não string como missing_variable', () => {
    const result = ingestContacts('Olá {{nome}}', [
      { phone: '5511900000001', variables: { nome: '' } },
      { phone: '5511900000002', variables: { nome: 7 } },
    ])
    expect(result.rejected.map((r) => r.reason)).toEqual(['missing_variable', 'missing_variable'])
  })

  it('trata variables que não é objeto como vazio', () => {
    const semPlaceholder = ingestContacts('Oi', [{ phone: '5511912345678', variables: 'x' }])
    expect(semPlaceholder.accepted).toEqual([{ phone: '5511912345678', body: 'Oi' }])
    const comPlaceholder = ingestContacts('Oi {{nome}}', [{ phone: '5511912345678', variables: ['Ana'] }])
    expect(comPlaceholder.rejected).toEqual([{ phone: '5511912345678', reason: 'missing_variable' }])
  })

  it('rejeita como duplicate o telefone repetido após normalização, com o telefone como veio', () => {
    const result = ingestContacts('Oi', [{ phone: '5511912345678' }, { phone: '+55 (11) 91234-5678' }])
    expect(result.accepted).toEqual([{ phone: '5511912345678', body: 'Oi' }])
    expect(result.rejected).toEqual([{ phone: '+55 (11) 91234-5678', reason: 'duplicate' }])
  })

  it('checa invalid_number antes de missing_variable', () => {
    const result = ingestContacts('Olá {{nome}}', [{ phone: '123', variables: {} }])
    expect(result.rejected).toEqual([{ phone: '123', reason: 'invalid_number' }])
  })

  it('checa missing_variable antes de duplicate', () => {
    const result = ingestContacts('Olá {{nome}}', [
      { phone: '5511912345678', variables: { nome: 'Ana' } },
      { phone: '5511912345678', variables: {} },
    ])
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toEqual([{ phone: '5511912345678', reason: 'missing_variable' }])
  })

  it('checa invalid_number antes de duplicate', () => {
    const result = ingestContacts('Oi', [{ phone: '5511912340000' }, { phone: '5511912340000' }])
    expect(result.rejected.map((r) => r.reason)).toEqual(['invalid_number', 'invalid_number'])
  })

  it('telefone rejeitado por missing_variable não segura o duplicate: o próximo igual é aceito', () => {
    const result = ingestContacts('Olá {{nome}}', [
      { phone: '5511912345678', variables: {} },
      { phone: '5511912345678', variables: { nome: 'Ana' } },
    ])
    expect(result.rejected).toEqual([{ phone: '5511912345678', reason: 'missing_variable' }])
    expect(result.accepted).toEqual([{ phone: '5511912345678', body: 'Olá Ana' }])
  })

  it('devolve as duas listas mesmo quando todos os contatos são rejeitados', () => {
    const result = ingestContacts('Oi', [{ phone: '1' }, null])
    expect(result.accepted).toEqual([])
    expect(result.rejected).toHaveLength(2)
  })

  it('mistura aceitos e rejeitados preservando a ordem de cada lista', () => {
    const result = ingestContacts('Oi', [
      { phone: '5511900000001' },
      { phone: 'x' },
      { phone: '5511900000002' },
      { phone: '5511900000001' },
    ])
    expect(result.accepted.map((c) => c.phone)).toEqual(['5511900000001', '5511900000002'])
    expect(result.rejected).toEqual([
      { phone: 'x', reason: 'invalid_number' },
      { phone: '5511900000001', reason: 'duplicate' },
    ])
  })
})
