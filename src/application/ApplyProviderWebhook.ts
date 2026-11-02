import { decideWebhook } from '../domain/messageTransitions'
import { parseWebhookEvent } from '../domain/webhookEvent'
import type { ProviderWebhookStore } from '../ports/campaignRepository'

export type ApplyProviderWebhookResult = { kind: 'invalid' } | { kind: 'ok' }

export class ApplyProviderWebhook {
  /**
   * @param store Porta que aplica o evento de forma idempotente.
   */
  constructor(private readonly store: ProviderWebhookStore) {}

  /**
   * Valida o webhook e o entrega ao repositório com `decideWebhook`; evento duplicado
   * ou de mensagem desconhecida também é `ok`.
   * @param raw Corpo bruto do webhook.
   */
  async execute(raw: unknown): Promise<ApplyProviderWebhookResult> {
    const parsed = parseWebhookEvent(raw)
    if (parsed.kind === 'invalid') return { kind: 'invalid' }
    const { event } = parsed
    await this.store.applyWebhookEvent(event, (current) => decideWebhook(current, event))
    return { kind: 'ok' }
  }
}
