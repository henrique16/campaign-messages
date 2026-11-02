import { CreateCampaign } from '../../../src/application/CreateCampaign'
import { FakeCampaignCreator } from '../../helpers/fakes'

describe('CreateCampaign', () => {
  it('corpo inválido devolve invalid e não chama a porta', async () => {
    const creator = new FakeCampaignCreator()
    const result = await new CreateCampaign(creator).execute({ template: '', contacts: [] })
    expect(result).toEqual({ kind: 'invalid' })
    expect(creator.calls).toHaveLength(0)
  })

  it('corpo que não é objeto devolve invalid e não chama a porta', async () => {
    const creator = new FakeCampaignCreator()
    expect(await new CreateCampaign(creator).execute(null)).toEqual({ kind: 'invalid' })
    expect(creator.calls).toHaveLength(0)
  })

  it('corpo válido chama a porta com o template e os aceitos, e devolve id, quantidade e rejeitados', async () => {
    const creator = new FakeCampaignCreator(42)
    const result = await new CreateCampaign(creator).execute({
      template: 'Olá {{nome}}',
      contacts: [
        { phone: '+55 (11) 91234-5678', variables: { nome: 'Ana' } },
        { phone: '123', variables: { nome: 'Beto' } },
        { phone: '5511912345678', variables: { nome: 'Ana de novo' } },
      ],
    })
    expect(creator.calls).toEqual([
      { template: 'Olá {{nome}}', accepted: [{ phone: '5511912345678', body: 'Olá Ana' }] },
    ])
    expect(result).toEqual({
      kind: 'created',
      id: 42,
      accepted: 1,
      rejected: [
        { phone: '123', reason: 'invalid_number' },
        { phone: '5511912345678', reason: 'duplicate' },
      ],
    })
  })

  it('com todos os contatos rejeitados ainda chama a porta e devolve as duas listas', async () => {
    const creator = new FakeCampaignCreator(9)
    const result = await new CreateCampaign(creator).execute({
      template: 'Oi',
      contacts: [{ phone: 'x' }, null],
    })
    expect(creator.calls).toEqual([{ template: 'Oi', accepted: [] }])
    expect(result).toEqual({
      kind: 'created',
      id: 9,
      accepted: 0,
      rejected: [
        { phone: 'x', reason: 'invalid_number' },
        { phone: '', reason: 'invalid_number' },
      ],
    })
  })
})
