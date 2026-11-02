/**
 * Erro lançado: objeto com `message` e `status` opcional (formato do `fakeProvider.js`).
 * Qualquer outro valor lançado é tratado como transitório.
 */
export interface MessageProvider {
  send(input: { to: string; body: string }): Promise<{ providerMessageId: string }>
}
