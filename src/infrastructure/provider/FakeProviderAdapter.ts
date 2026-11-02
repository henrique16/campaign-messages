import type { MessageProvider } from '../../ports/MessageProvider'

type SendMessage = (args: { to: string; body: string }) => Promise<{ providerMessageId: string }>

const fakeProvider = require('../../../fakeProvider') as { sendMessage: SendMessage }

/** Adapta o `fakeProvider.js` da raiz à porta `MessageProvider`. */
export class FakeProviderAdapter implements MessageProvider {
  /**
   * @param sendMessage Função de envio; o padrão é `fakeProvider.sendMessage`.
   */
  constructor(private readonly sendMessage: SendMessage = fakeProvider.sendMessage) {}

  /**
   * Delega o envio à função configurada; erros do provedor sobem sem alteração.
   * @param input Destino e corpo da mensagem.
   */
  send(input: { to: string; body: string }): Promise<{ providerMessageId: string }> {
    return this.sendMessage(input)
  }
}
