import type { MessageStatus } from './messageStatus'
import type { WebhookEvent, WebhookStatus } from './webhookEvent'

export const DEFAULT_WEBHOOK_FAILURE_REASON = 'provider_failed'

export type WebhookDecision =
  | { kind: 'ignore' }
  | { kind: 'apply'; next: 'delivered' | 'read' }
  | { kind: 'apply'; next: 'failed'; reason: string }

/** Estados de origem que cada evento de webhook pode mover; qualquer outro é ignorado. */
const WEBHOOK_SOURCES: Record<WebhookStatus, readonly MessageStatus[]> = {
  delivered: ['sent'],
  read: ['sent', 'delivered'],
  failed: ['sent', 'delivered', 'read'],
}

/**
 * Decide o próximo estado da mensagem para um evento de webhook. Não grava nada:
 * o repositório executa a escrita. Eventos que retrocederiam ou vindos de `queued` são ignorados.
 * @param current Estado atual da mensagem.
 * @param event Evento já validado.
 */
export function decideWebhook(current: MessageStatus, event: WebhookEvent): WebhookDecision {
  if (!WEBHOOK_SOURCES[event.status].includes(current)) return { kind: 'ignore' }
  if (event.status === 'failed') {
    return { kind: 'apply', next: 'failed', reason: event.reason !== '' ? event.reason : DEFAULT_WEBHOOK_FAILURE_REASON }
  }
  return { kind: 'apply', next: event.status }
}
