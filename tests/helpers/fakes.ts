import type { AcceptedContact } from '../../src/domain/createCampaignInput'
import type { WebhookEvent } from '../../src/domain/webhookEvent'
import type {
  CampaignCreator,
  CampaignFailureReader,
  CampaignFinisher,
  CampaignStarter,
  CampaignSummary,
  CampaignSummaryReader,
  ClaimDueInput,
  ClaimedMessage,
  DueMessageClaim,
  FailurePage,
  MessageOutcomeStore,
  ProviderWebhookStore,
  StartResult,
  WebhookApplyResult,
  WebhookDecider,
} from '../../src/ports/campaignRepository'
import type { Clock } from '../../src/ports/Clock'
import type { MessageProvider } from '../../src/ports/MessageProvider'

/** Registro ordenado de eventos entre vários fakes, para asserir a ordem das chamadas. */
export type EventLog = string[]

/** Relógio fixo: `now()` devolve sempre a mesma data. */
export class FakeClock implements Clock {
  /**
   * @param current Data devolvida por `now()`.
   */
  constructor(private readonly current: Date) {}

  /** Devolve a data fixa. */
  now(): Date {
    return this.current
  }
}

/** Fake de `CampaignCreator` que registra as chamadas. */
export class FakeCampaignCreator implements CampaignCreator {
  readonly calls: Array<{ template: string; accepted: readonly AcceptedContact[] }> = []

  /**
   * @param id Id devolvido por `createCampaignWithMessages`.
   */
  constructor(private readonly id: number = 1) {}

  /**
   * Registra a chamada e devolve o id configurado.
   * @param template Template recebido.
   * @param accepted Contatos aceitos recebidos.
   */
  async createCampaignWithMessages(template: string, accepted: readonly AcceptedContact[]): Promise<number> {
    this.calls.push({ template, accepted })
    return this.id
  }
}

/** Fake de `CampaignSummaryReader` que registra os ids consultados. */
export class FakeCampaignSummaryReader implements CampaignSummaryReader {
  readonly calls: number[] = []

  /**
   * @param summary Resumo devolvido; `null` simula campanha inexistente.
   */
  constructor(private readonly summary: CampaignSummary | null) {}

  /**
   * Registra o id e devolve o resumo configurado.
   * @param campaignId Campanha consultada.
   */
  async getSummary(campaignId: number): Promise<CampaignSummary | null> {
    this.calls.push(campaignId)
    return this.summary
  }
}

/** Fake de `CampaignFailureReader` que registra os argumentos de cada consulta. */
export class FakeCampaignFailureReader implements CampaignFailureReader {
  readonly calls: Array<{ campaignId: number; page: number; pageSize: number }> = []

  /**
   * @param result Página devolvida; `null` simula campanha inexistente.
   */
  constructor(private readonly result: FailurePage | null) {}

  /**
   * Registra a consulta e devolve o resultado configurado.
   * @param campaignId Campanha consultada.
   * @param page Página pedida (1-based).
   * @param pageSize Tamanho da página.
   */
  async listFailures(campaignId: number, page: number, pageSize: number): Promise<FailurePage | null> {
    this.calls.push({ campaignId, page, pageSize })
    return this.result
  }
}

/** Fake de `CampaignStarter` que registra os ids iniciados. */
export class FakeCampaignStarter implements CampaignStarter {
  readonly calls: number[] = []

  /**
   * @param result Resultado devolvido por `markRunningIfDraft`.
   */
  constructor(private readonly result: StartResult) {}

  /**
   * Registra o id e devolve o resultado configurado.
   * @param campaignId Campanha a iniciar.
   */
  async markRunningIfDraft(campaignId: number): Promise<StartResult> {
    this.calls.push(campaignId)
    return this.result
  }
}

/** Fake de `CampaignFinisher` que registra os ids encerrados. */
export class FakeCampaignFinisher implements CampaignFinisher {
  readonly calls: number[] = []

  /**
   * Registra o id encerrado.
   * @param campaignId Campanha marcada como `finished`.
   */
  async markFinished(campaignId: number): Promise<void> {
    this.calls.push(campaignId)
  }
}

/**
 * Fake do sub-orquestrador `FinishCampaignIfDone` (só o método `execute`), usado por
 * `StartCampaign` e `ProcessClaimedMessage`. Escreve `finish:<id>` no log de eventos, se houver.
 */
export class FakeFinishIfDone {
  readonly calls: number[] = []

  /**
   * @param log Log compartilhado para asserir a ordem em relação a outros fakes.
   */
  constructor(private readonly log?: EventLog) {}

  /**
   * Registra a avaliação de encerramento.
   * @param campaignId Campanha avaliada.
   */
  async execute(campaignId: number): Promise<void> {
    this.calls.push(campaignId)
    this.log?.push(`finish:${campaignId}`)
  }
}

/** Fake de `DueMessageClaim`: devolve uma lista por chamada, na ordem; depois disso devolve `[]`. */
export class FakeDueMessageClaim implements DueMessageClaim {
  readonly calls: ClaimDueInput[] = []
  private readonly results: ClaimedMessage[][]

  /**
   * @param results Uma lista de claims para cada chamada sucessiva de `claimDue`.
   * @param failWith Quando definido, `claimDue` rejeita com este valor.
   */
  constructor(
    results: ClaimedMessage[][] = [],
    private readonly failWith?: unknown,
  ) {
    this.results = [...results]
  }

  /**
   * Registra o pedido e devolve o próximo resultado configurado (ou rejeita).
   * @param input Pedido de claim recebido.
   */
  async claimDue(input: ClaimDueInput): Promise<ClaimedMessage[]> {
    this.calls.push(input)
    if (this.failWith !== undefined) throw this.failWith
    return this.results.shift() ?? []
  }
}

/** Fake de `MessageOutcomeStore`; escreve `sent:<id>`, `retry:<id>` e `failed:<id>` no log, se houver. */
export class FakeMessageOutcomeStore implements MessageOutcomeStore {
  readonly sent: Array<{ messageId: number; providerMessageId: string }> = []
  readonly retries: Array<{ messageId: number; attemptCount: number; nextAttemptAt: Date }> = []
  readonly failed: Array<{ messageId: number; reason: string }> = []

  /**
   * @param log Log compartilhado para asserir a ordem em relação a outros fakes.
   * @param failWith Quando definido, qualquer gravação rejeita com este erro.
   */
  constructor(
    private readonly log?: EventLog,
    private readonly failWith?: Error,
  ) {}

  /**
   * Registra `sent`.
   * @param messageId Mensagem enviada.
   * @param providerMessageId Id devolvido pelo provedor.
   */
  async recordSent(messageId: number, providerMessageId: string): Promise<void> {
    if (this.failWith) throw this.failWith
    this.sent.push({ messageId, providerMessageId })
    this.log?.push(`sent:${messageId}`)
  }

  /**
   * Registra o reagendamento.
   * @param messageId Mensagem reagendada.
   * @param attemptCount Novo número de tentativas.
   * @param nextAttemptAt Próximo horário de tentativa.
   */
  async recordRetry(messageId: number, attemptCount: number, nextAttemptAt: Date): Promise<void> {
    if (this.failWith) throw this.failWith
    this.retries.push({ messageId, attemptCount, nextAttemptAt })
    this.log?.push(`retry:${messageId}`)
  }

  /**
   * Registra `failed`.
   * @param messageId Mensagem que falhou.
   * @param reason Motivo gravado.
   */
  async recordFailed(messageId: number, reason: string): Promise<void> {
    if (this.failWith) throw this.failWith
    this.failed.push({ messageId, reason })
    this.log?.push(`failed:${messageId}`)
  }
}

/** Fake de `ProviderWebhookStore` que guarda o evento e o decider recebidos. */
export class FakeProviderWebhookStore implements ProviderWebhookStore {
  readonly calls: Array<{ event: WebhookEvent; decide: WebhookDecider }> = []

  /**
   * @param result Resultado devolvido por `applyWebhookEvent`.
   */
  constructor(private readonly result: WebhookApplyResult = 'applied') {}

  /**
   * Registra a chamada e devolve o resultado configurado, sem invocar o decider.
   * @param event Evento recebido.
   * @param decide Decider recebido.
   */
  async applyWebhookEvent(event: WebhookEvent, decide: WebhookDecider): Promise<WebhookApplyResult> {
    this.calls.push({ event, decide })
    return this.result
  }
}

/** Fake de `MessageProvider` cujo comportamento é uma função (devolve id ou lança). */
export class FakeMessageProvider implements MessageProvider {
  readonly calls: Array<{ to: string; body: string }> = []

  /**
   * @param behavior Função chamada a cada envio; pode devolver o id ou lançar.
   */
  constructor(
    private readonly behavior: (input: { to: string; body: string }) => Promise<{ providerMessageId: string }>,
  ) {}

  /**
   * Registra o envio e delega ao comportamento configurado.
   * @param input Destinatário e corpo.
   */
  send(input: { to: string; body: string }): Promise<{ providerMessageId: string }> {
    this.calls.push(input)
    return this.behavior(input)
  }
}

/**
 * Cria um provedor que sempre envia com sucesso.
 * @param providerMessageId Id devolvido pelo provedor.
 */
export function providerThatSends(providerMessageId: string = 'prov-1'): FakeMessageProvider {
  return new FakeMessageProvider(async () => ({ providerMessageId }))
}

/**
 * Cria um provedor que sempre lança o valor dado.
 * @param thrown Valor lançado em cada envio.
 */
export function providerThatThrows(thrown: unknown): FakeMessageProvider {
  return new FakeMessageProvider(async () => {
    throw thrown
  })
}

/**
 * Monta uma mensagem reivindicada com valores padrão.
 * @param overrides Campos a sobrescrever.
 */
export function makeClaim(overrides: Partial<ClaimedMessage> = {}): ClaimedMessage {
  return { messageId: 10, campaignId: 3, phone: '5511912345678', body: 'Olá Ana', attemptCount: 0, ...overrides }
}

/**
 * Monta um resumo de campanha com totais zerados por padrão.
 * @param overrides Campos a sobrescrever; `totals` é mesclado com os zeros.
 */
export function makeSummary(
  overrides: Partial<Omit<CampaignSummary, 'totals'>> & { totals?: Partial<CampaignSummary['totals']> } = {},
): CampaignSummary {
  const { totals, ...rest } = overrides
  return {
    id: 3,
    status: 'running',
    ...rest,
    totals: { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, ...totals },
  }
}

/**
 * Cria um stub de caso de uso (objeto com `execute`) que registra os argumentos e devolve sempre `result`.
 * @param result Valor devolvido por `execute`.
 */
export function stubUseCase<TArgs extends unknown[], TResult>(result: TResult): {
  calls: TArgs[]
  execute: (...args: TArgs) => Promise<TResult>
} {
  const calls: TArgs[] = []
  return {
    calls,
    execute: async (...args: TArgs): Promise<TResult> => {
      calls.push(args)
      return result
    },
  }
}

/**
 * Cria uma promessa que o teste resolve ou rejeita quando quiser, para segurar um envio "em voo".
 */
export function createDeferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Deixa a fila de microtarefas esvaziar sem timers nem espera de relógio.
 */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}
