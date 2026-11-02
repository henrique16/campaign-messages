import { FinishCampaignIfDone } from '../../../src/application/FinishCampaignIfDone'
import { FakeCampaignFinisher, FakeCampaignSummaryReader, makeSummary } from '../../helpers/fakes'

describe('FinishCampaignIfDone', () => {
  it('resumo null não faz nada', async () => {
    const reader = new FakeCampaignSummaryReader(null)
    const finisher = new FakeCampaignFinisher()
    await new FinishCampaignIfDone(reader, finisher).execute(3)
    expect(reader.calls).toEqual([3])
    expect(finisher.calls).toHaveLength(0)
  })

  it('running com 0 queued chama markFinished com o id da campanha', async () => {
    const finisher = new FakeCampaignFinisher()
    const reader = new FakeCampaignSummaryReader(makeSummary({ status: 'running', totals: { sent: 4 } }))
    await new FinishCampaignIfDone(reader, finisher).execute(3)
    expect(finisher.calls).toEqual([3])
  })

  it('running com queued maior que 0 não chama markFinished', async () => {
    const finisher = new FakeCampaignFinisher()
    const reader = new FakeCampaignSummaryReader(makeSummary({ status: 'running', totals: { queued: 2 } }))
    await new FinishCampaignIfDone(reader, finisher).execute(3)
    expect(finisher.calls).toHaveLength(0)
  })

  it('draft com 0 queued não chama markFinished', async () => {
    const finisher = new FakeCampaignFinisher()
    const reader = new FakeCampaignSummaryReader(makeSummary({ status: 'draft' }))
    await new FinishCampaignIfDone(reader, finisher).execute(3)
    expect(finisher.calls).toHaveLength(0)
  })

  it('finished com 0 queued não chama markFinished', async () => {
    const finisher = new FakeCampaignFinisher()
    const reader = new FakeCampaignSummaryReader(makeSummary({ status: 'finished' }))
    await new FinishCampaignIfDone(reader, finisher).execute(3)
    expect(finisher.calls).toHaveLength(0)
  })
})
