export const CLAIM_TTL_MS = 30_000
export const PAGE_SIZE = 50
export const PHONE_MIN = 10
export const PHONE_MAX = 15

export type PageParse = { kind: 'page'; page: number } | { kind: 'invalid' }

/**
 * Interpreta o parâmetro `page` (1-based): ausente vale 1; 0, negativo,
 * não inteiro ou não numérico é inválido. Aceita número ou string só de dígitos.
 * @param raw Valor bruto recebido do cliente.
 */
export function parsePage(raw: unknown): PageParse {
  if (raw === undefined) return { kind: 'page', page: 1 }
  const page = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return { kind: 'invalid' }
  return { kind: 'page', page }
}
