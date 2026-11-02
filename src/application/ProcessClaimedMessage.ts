import type { ProviderErrorClassifier, ProviderFailure } from '../domain/providerFailure'
import { RETRY_EXHAUSTED_REASON } from '../domain/retryPolicy'
import type { RetryPolicy } from '../domain/retryPolicy'
import type { ClaimedMessage, MessageOutcomeStore } from '../ports/campaignRepository'
import type { Clock } from '../ports/Clock'
import type { MessageProvider } from '../ports/MessageProvider'
import type { FinishCampaignIfDone } from './FinishCampaignIfDone'

type SendAttempt = { kind: 'sent'; providerMessageId: string } | ProviderFailure

export class ProcessClaimedMessage {
  /**
   * @param provider Porta de envio.
   * @param classifyError Classificador do erro lançado pelo provedor.
   * @param retryPolicy Decide retry ou falha após erro transitório.
   * @param clock Relógio para calcular o próximo horário de tentativa.
   * @param outcomes Porta que grava o resultado do envio.
   * @param finishIfDone Sub-orquestrador chamado após `sent` ou `failed`.
   */
  constructor(
    private readonly provider: MessageProvider,
    private readonly classifyError: ProviderErrorClassifier,
    private readonly retryPolicy: RetryPolicy,
    private readonly clock: Clock,
    private readonly outcomes: MessageOutcomeStore,
    private readonly finishIfDone: Pick<FinishCampaignIfDone, 'execute'>,
  ) {}

  /**
   * Envia uma mensagem reivindicada e grava o resultado; só `sent` e `failed` avaliam o
   * encerramento da campanha, nunca o retry. Erros do repositório sobem para quem chama.
   * @param claim Mensagem já reivindicada.
   */
  async execute(claim: ClaimedMessage): Promise<void> {
    const attempt = await this.attemptSend(claim)
    if (attempt.kind === 'sent') {
      await this.outcomes.recordSent(claim.messageId, attempt.providerMessageId)
    } else if (attempt.kind === 'permanent') {
      await this.outcomes.recordFailed(claim.messageId, attempt.reason)
    } else {
      const decision = this.retryPolicy(claim.attemptCount)
      if (decision.kind === 'retry') {
        const nextAttemptAt = new Date(this.clock.now().getTime() + decision.delayMs)
        await this.outcomes.recordRetry(claim.messageId, claim.attemptCount + 1, nextAttemptAt)
        return
      }
      await this.outcomes.recordFailed(claim.messageId, RETRY_EXHAUSTED_REASON)
    }
    await this.finishIfDone.execute(claim.campaignId)
  }

  /**
   * Chama o provedor e converte sucesso ou erro lançado em um resultado sem exceção.
   * @param claim Mensagem a enviar.
   */
  private async attemptSend(claim: ClaimedMessage): Promise<SendAttempt> {
    try {
      const { providerMessageId } = await this.provider.send({ to: claim.phone, body: claim.body })
      return { kind: 'sent', providerMessageId }
    } catch (err) {
      return this.classifyError(err)
    }
  }
}
