import type { CampaignStatus } from './campaignStatus'

/**
 * A campanha termina quando está `running` e não resta nenhuma mensagem `queued`.
 * @param status Status atual da campanha.
 * @param queuedCount Mensagens ainda `queued`.
 */
export function shouldFinish(status: CampaignStatus, queuedCount: number): boolean {
  return status === 'running' && queuedCount === 0
}
