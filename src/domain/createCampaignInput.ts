import { isValidPhone, normalizePhone } from './phone'
import { renderTemplate } from './template'

export type RejectionReason = 'invalid_number' | 'duplicate' | 'missing_variable'

export type AcceptedContact = { phone: string; body: string }

export type RejectedContact = { phone: string; reason: RejectionReason }

export type CreateCampaignParse =
  | { kind: 'invalid' }
  | { kind: 'valid'; template: string; contacts: readonly unknown[] }

export type IngestResult = { accepted: AcceptedContact[]; rejected: RejectedContact[] }

/**
 * Verifica o corpo do create: precisa de `template` string não vazio e `contacts` array não vazio.
 * @param raw Corpo já decodificado, de tipo desconhecido.
 */
export function parseCreateCampaign(raw: unknown): CreateCampaignParse {
  if (!isRecord(raw)) return { kind: 'invalid' }
  const { template, contacts } = raw
  if (typeof template !== 'string' || template === '') return { kind: 'invalid' }
  if (!Array.isArray(contacts) || contacts.length === 0) return { kind: 'invalid' }
  return { kind: 'valid', template, contacts }
}

/**
 * Valida e renderiza cada contato, nesta ordem: `invalid_number`, `missing_variable`, `duplicate`.
 * Duplicado só é checado contra contatos já aceitos. O telefone dos rejeitados volta como veio
 * do cliente (`''` quando o contato não tem telefone string).
 * @param template Template já validado.
 * @param contacts Contatos brutos.
 */
export function ingestContacts(template: string, contacts: readonly unknown[]): IngestResult {
  const accepted: AcceptedContact[] = []
  const rejected: RejectedContact[] = []
  const seen = new Set<string>()

  for (const contact of contacts) {
    const rawPhone = isRecord(contact) && typeof contact.phone === 'string' ? contact.phone : ''
    const phone = normalizePhone(rawPhone)
    if (!isRecord(contact) || typeof contact.phone !== 'string' || !isValidPhone(phone)) {
      rejected.push({ phone: rawPhone, reason: 'invalid_number' })
      continue
    }
    const rendered = renderTemplate(template, isRecord(contact.variables) ? contact.variables : {})
    if (rendered.kind === 'missing_variable') {
      rejected.push({ phone: rawPhone, reason: 'missing_variable' })
      continue
    }
    if (seen.has(phone)) {
      rejected.push({ phone: rawPhone, reason: 'duplicate' })
      continue
    }
    seen.add(phone)
    accepted.push({ phone, body: rendered.body })
  }
  return { accepted, rejected }
}

/**
 * Diz se o valor é um objeto simples (não nulo e não array).
 * @param value Valor a testar.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
