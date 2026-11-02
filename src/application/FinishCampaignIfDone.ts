import { shouldFinish } from '../domain/campaignFinish'
import type { CampaignFinisher, CampaignSummaryReader } from '../ports/campaignRepository'

export class FinishCampaignIfDone {
  /**
   * @param reader Porta que lê o resumo da campanha.
   * @param finisher Porta que marca a campanha como `finished`.
   */
  constructor(
    private readonly reader: CampaignSummaryReader,
    private readonly finisher: CampaignFinisher,
  ) {}

  /**
   * Marca a campanha como `finished` se a regra mandar; não faz nada se ela não existe.
   * @param campaignId Campanha a avaliar.
   */
  async execute(campaignId: number): Promise<void> {
    const summary = await this.reader.getSummary(campaignId)
    if (summary !== null && shouldFinish(summary.status, summary.totals.queued)) {
      await this.finisher.markFinished(campaignId)
    }
  }
}
