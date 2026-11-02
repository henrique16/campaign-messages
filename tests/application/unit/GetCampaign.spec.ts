import { GetCampaign } from '../../../src/application/GetCampaign'
import { FakeCampaignSummaryReader, makeSummary } from '../../helpers/fakes'

describe('GetCampaign', () => {
  it('resumo null devolve not_found', async () => {
    const reader = new FakeCampaignSummaryReader(null)
    const result = await new GetCampaign(reader).execute(5)
    expect(result).toEqual({ kind: 'not_found' })
    expect(reader.calls).toEqual([5])
  })

  it('com resumo devolve ok com id, status e totais', async () => {
    const summary = makeSummary({ id: 5, status: 'finished', totals: { sent: 2, failed: 1, read: 3 } })
    const result = await new GetCampaign(new FakeCampaignSummaryReader(summary)).execute(5)
    expect(result).toEqual({
      kind: 'ok',
      id: 5,
      status: 'finished',
      totals: { queued: 0, sent: 2, delivered: 0, read: 3, failed: 1 },
    })
  })
})
