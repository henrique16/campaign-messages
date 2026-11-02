import { PHONE_MAX, PHONE_MIN } from './rules'

/**
 * Remove tudo que não for dígito do telefone.
 * @param raw Telefone como o cliente enviou.
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

/**
 * Diz se um telefone já normalizado é aceito: de 10 a 15 dígitos e sem terminar em `0000`.
 * @param normalized Resultado de `normalizePhone`.
 */
export function isValidPhone(normalized: string): boolean {
  return normalized.length >= PHONE_MIN && normalized.length <= PHONE_MAX && !normalized.endsWith('0000')
}
