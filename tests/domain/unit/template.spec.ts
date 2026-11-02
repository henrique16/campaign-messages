import { extractPlaceholders, renderTemplate } from '../../../src/domain/template'

describe('extractPlaceholders', () => {
  it('lista as chaves distintas na ordem em que aparecem', () => {
    expect(extractPlaceholders('Oi {{nome}}, código {{cod}}. Tchau {{nome}}')).toEqual(['nome', 'cod'])
  })

  it('devolve lista vazia quando não há placeholders', () => {
    expect(extractPlaceholders('Olá mundo')).toEqual([])
  })

  it('aceita letras, dígitos e sublinhado nas chaves', () => {
    expect(extractPlaceholders('{{a_1}} {{B2}} {{_x}}')).toEqual(['a_1', 'B2', '_x'])
  })

  it('ignora chaves com caracteres fora de [A-Za-z0-9_]', () => {
    expect(extractPlaceholders('{{ nome }} {{no-me}} {{}} {{a.b}}')).toEqual([])
  })
})

describe('renderTemplate', () => {
  it('substitui o placeholder pelo valor string', () => {
    expect(renderTemplate('Olá {{nome}}', { nome: 'Ana' })).toEqual({ kind: 'rendered', body: 'Olá Ana' })
  })

  it('substitui todas as ocorrências da mesma chave', () => {
    expect(renderTemplate('{{n}} e {{n}}', { n: 'X' })).toEqual({ kind: 'rendered', body: 'X e X' })
  })

  it('renderiza template sem placeholders mesmo sem variáveis', () => {
    expect(renderTemplate('Promoção hoje', {})).toEqual({ kind: 'rendered', body: 'Promoção hoje' })
  })

  it('ignora chaves extras em variables', () => {
    expect(renderTemplate('Olá {{nome}}', { nome: 'Ana', sobra: 'x', outra: 1 })).toEqual({
      kind: 'rendered',
      body: 'Olá Ana',
    })
  })

  it('devolve missing_variable quando a chave não existe', () => {
    expect(renderTemplate('Olá {{nome}}', {})).toEqual({ kind: 'missing_variable' })
  })

  it('devolve missing_variable quando o valor é string vazia', () => {
    expect(renderTemplate('Olá {{nome}}', { nome: '' })).toEqual({ kind: 'missing_variable' })
  })

  it('devolve missing_variable quando o valor não é string', () => {
    expect(renderTemplate('Olá {{nome}}', { nome: 5 })).toEqual({ kind: 'missing_variable' })
    expect(renderTemplate('Olá {{nome}}', { nome: null })).toEqual({ kind: 'missing_variable' })
    expect(renderTemplate('Olá {{nome}}', { nome: undefined })).toEqual({ kind: 'missing_variable' })
    expect(renderTemplate('Olá {{nome}}', { nome: ['Ana'] })).toEqual({ kind: 'missing_variable' })
  })

  it('devolve missing_variable se qualquer uma das chaves faltar', () => {
    expect(renderTemplate('{{a}} {{b}}', { a: 'x' })).toEqual({ kind: 'missing_variable' })
  })

  it('não lê o protótipo: {{constructor}} sem propriedade própria é missing_variable', () => {
    expect(renderTemplate('{{constructor}}', {})).toEqual({ kind: 'missing_variable' })
    expect(renderTemplate('{{hasOwnProperty}}', {})).toEqual({ kind: 'missing_variable' })
    expect(renderTemplate('{{toString}}', {})).toEqual({ kind: 'missing_variable' })
  })

  it('aceita {{constructor}} quando é propriedade própria string', () => {
    expect(renderTemplate('{{constructor}}', { constructor: 'valor' })).toEqual({
      kind: 'rendered',
      body: 'valor',
    })
  })

  it('insere o valor literalmente, sem interpretar padrões de substituição como $&', () => {
    expect(renderTemplate('Oi {{nome}}', { nome: '$&' })).toEqual({ kind: 'rendered', body: 'Oi $&' })
  })
})
