import { ListCampaignFailures } from '../../../src/application/ListCampaignFailures'
import { FakeCampaignFailureReader } from '../../helpers/fakes'

describe('ListCampaignFailures', () => {
  it.each([['0'], ['abc'], [-1], [1.5], ['1.5']])(
    'página inválida (%p) devolve invalid e não chama a porta',
    async (rawPage) => {
      const reader = new FakeCampaignFailureReader({ items: [], total: 0 })
      const result = await new ListCampaignFailures(reader).execute(3, rawPage)
      expect(result).toEqual({ kind: 'invalid' })
      expect(reader.calls).toHaveLength(0)
    },
  )

  it('page ausente vale 1 e a porta recebe pageSize 50', async () => {
    const reader = new FakeCampaignFailureReader({ items: [], total: 0 })
    await new ListCampaignFailures(reader).execute(3, undefined)
    expect(reader.calls).toEqual([{ campaignId: 3, page: 1, pageSize: 50 }])
  })

  it('page em string de dígitos é convertida para número', async () => {
    const reader = new FakeCampaignFailureReader({ items: [], total: 0 })
    await new ListCampaignFailures(reader).execute(3, '4')
    expect(reader.calls).toEqual([{ campaignId: 3, page: 4, pageSize: 50 }])
  })

  it('resultado null da porta devolve not_found', async () => {
    const result = await new ListCampaignFailures(new FakeCampaignFailureReader(null)).execute(3, undefined)
    expect(result).toEqual({ kind: 'not_found' })
  })

  it('ok devolve itens, página pedida, pageSize 50 e total', async () => {
    const items = [
      { phone: '5511912345678', reason: 'invalid_number' },
      { phone: '5511912345679', reason: 'provider_unavailable' },
    ]
    const result = await new ListCampaignFailures(new FakeCampaignFailureReader({ items, total: 120 })).execute(
      3,
      '2',
    )
    expect(result).toEqual({ kind: 'ok', items, page: 2, pageSize: 50, total: 120 })
  })
})
