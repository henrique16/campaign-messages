import type { CampaignStatus } from '../domain/campaignStatus'
import type { CampaignSummaryReader, CampaignTotals } from '../ports/campaignRepository'

export type GetCampaignResult =
  | { kind: 'not_found' }
  | { kind: 'ok'; id: number; status: CampaignStatus; totals: CampaignTotals }

export class GetCampaign {
  /**
   * @param reader Porta que lê o resumo da campanha.
   */
  constructor(private readonly reader: CampaignSummaryReader) {}

  /**
   * Devolve status e totais da campanha.
   * @param campaignId Campanha consultada.
   */
  async execute(campaignId: number): Promise<GetCampaignResult> {
    const summary = await this.reader.getSummary(campaignId)
    if (summary === null) return { kind: 'not_found' }
    return { kind: 'ok', id: summary.id, status: summary.status, totals: summary.totals }
  }
}
