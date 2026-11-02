import { StartCampaign } from '../../../src/application/StartCampaign'
import { FakeCampaignStarter, FakeFinishIfDone } from '../../helpers/fakes'

describe('StartCampaign', () => {
  it('started chama o encerramento e devolve status running', async () => {
    const starter = new FakeCampaignStarter({ kind: 'started' })
    const finish = new FakeFinishIfDone()
    const result = await new StartCampaign(starter, finish).execute(7)
    expect(starter.calls).toEqual([7])
    expect(finish.calls).toEqual([7])
    expect(result).toEqual({ kind: 'status', status: 'running' })
  })

  it('unchanged running devolve o status atual sem chamar o encerramento', async () => {
    const starter = new FakeCampaignStarter({ kind: 'unchanged', status: 'running' })
    const finish = new FakeFinishIfDone()
    const result = await new StartCampaign(starter, finish).execute(7)
    expect(result).toEqual({ kind: 'status', status: 'running' })
    expect(finish.calls).toHaveLength(0)
  })

  it('unchanged finished devolve finished sem chamar o encerramento', async () => {
    const starter = new FakeCampaignStarter({ kind: 'unchanged', status: 'finished' })
    const finish = new FakeFinishIfDone()
    const result = await new StartCampaign(starter, finish).execute(7)
    expect(result).toEqual({ kind: 'status', status: 'finished' })
    expect(finish.calls).toHaveLength(0)
  })

  it('not_found devolve not_found sem chamar o encerramento', async () => {
    const starter = new FakeCampaignStarter({ kind: 'not_found' })
    const finish = new FakeFinishIfDone()
    const result = await new StartCampaign(starter, finish).execute(7)
    expect(result).toEqual({ kind: 'not_found' })
    expect(finish.calls).toHaveLength(0)
  })
})
