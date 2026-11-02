const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g

export type RenderResult = { kind: 'rendered'; body: string } | { kind: 'missing_variable' }

/**
 * Lista as chaves distintas dos placeholders `{{chave}}`, na ordem em que aparecem.
 * @param template Texto do template.
 */
export function extractPlaceholders(template: string): string[] {
  const keys = Array.from(template.matchAll(PLACEHOLDER), (match) => match[1])
  return Array.from(new Set(keys))
}

/**
 * Substitui cada `{{chave}}` pelo valor de `variables`. Chave ausente, valor
 * não string ou string vazia resulta em `missing_variable`; chaves extras são ignoradas.
 * @param template Texto do template.
 * @param variables Variáveis do contato.
 */
export function renderTemplate(template: string, variables: Record<string, unknown>): RenderResult {
  /**
   * Diz se `variables` tem a chave como propriedade própria, com string não vazia.
   * @param key Chave do placeholder.
   */
  const hasValue = (key: string): boolean => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) return false
    const value = variables[key]
    return typeof value === 'string' && value !== ''
  }
  if (!extractPlaceholders(template).every(hasValue)) return { kind: 'missing_variable' }
  return { kind: 'rendered', body: template.replace(PLACEHOLDER, (_match, key: string) => variables[key] as string) }
}
