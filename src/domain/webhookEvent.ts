export const WEBHOOK_STATUSES = ['delivered', 'read', 'failed'] as const

export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number]

/** `reason` é `''` quando ausente ou quando o status não é `failed`. */
export type WebhookEvent = {
  eventId: string
  providerMessageId: string
  status: WebhookStatus
  reason: string
}

export type WebhookParse = { kind: 'invalid' } | { kind: 'valid'; event: WebhookEvent }

/**
 * Valida o corpo do webhook: `event_id`, `provider_message_id` (strings não vazias)
 * e `status` entre `delivered`, `read` e `failed`. `reason` só vale para `failed`.
 * @param raw Corpo já decodificado, de tipo desconhecido.
 */
export function parseWebhookEvent(raw: unknown): WebhookParse {
  if (typeof raw !== 'object' || raw === null) return { kind: 'invalid' }
  const body = raw as Record<string, unknown>
  const { event_id: eventId, provider_message_id: providerMessageId, status, reason } = body
  if (typeof eventId !== 'string' || eventId === '') return { kind: 'invalid' }
  if (typeof providerMessageId !== 'string' || providerMessageId === '') return { kind: 'invalid' }
  if (!WEBHOOK_STATUSES.some((allowed) => allowed === status)) return { kind: 'invalid' }
  const webhookStatus = status as WebhookStatus
  const failureReason = webhookStatus === 'failed' && typeof reason === 'string' ? reason : ''
  return { kind: 'valid', event: { eventId, providerMessageId, status: webhookStatus, reason: failureReason } }
}
