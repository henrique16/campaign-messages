import type { CampaignStarter } from '../ports/campaignRepository'
import type { FinishCampaignIfDone } from './FinishCampaignIfDone'

export type StartCampaignResult =
  | { kind: 'not_found' }
  | { kind: 'status'; status: 'running' | 'finished' }

export class StartCampaign {
  /**
   * @param starter Porta que passa a campanha de `draft` para `running`.
   * @param finishIfDone Sub-orquestrador que encerra campanha sem mensagens `queued`.
   */
  constructor(
    private readonly starter: CampaignStarter,
    private readonly finishIfDone: Pick<FinishCampaignIfDone, 'execute'>,
  ) {}

  /**
   * Inicia a campanha. Se acabou de iniciar, avalia o encerramento (0 aceitos) e responde `running`;
   * se já estava iniciada, devolve o status atual sem reavaliar.
   * @param campaignId Campanha a iniciar.
   */
  async execute(campaignId: number): Promise<StartCampaignResult> {
    const result = await this.starter.markRunningIfDraft(campaignId)
    if (result.kind === 'not_found') return { kind: 'not_found' }
    if (result.kind === 'unchanged') return { kind: 'status', status: result.status }
    await this.finishIfDone.execute(campaignId)
    return { kind: 'status', status: 'running' }
  }
}
