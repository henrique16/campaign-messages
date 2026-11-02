import { CLAIM_TTL_MS } from '../domain/rules'
import type { ClaimedMessage, DueMessageClaim } from '../ports/campaignRepository'
import type { Clock } from '../ports/Clock'
import type { ProcessClaimedMessage } from './ProcessClaimedMessage'
import { MAX_IN_FLIGHT, WORKER_POLL_INTERVAL_MS_DEFAULT } from './workerConfig'

export class SendWorker {
  private inFlight = 0
  private timer: ReturnType<typeof setInterval> | undefined

  /**
   * @param claimer Porta que reivindica mensagens elegíveis.
   * @param clock Relógio para `now` e para o corte do claim obsoleto.
   * @param processor Processa cada mensagem reivindicada.
   * @param pollIntervalMs Intervalo entre ticks.
   */
  constructor(
    private readonly claimer: DueMessageClaim,
    private readonly clock: Clock,
    private readonly processor: Pick<ProcessClaimedMessage, 'execute'>,
    private readonly pollIntervalMs: number = WORKER_POLL_INTERVAL_MS_DEFAULT,
  ) {}

  /**
   * Um ciclo: reivindica até `MAX_IN_FLIGHT - emVoo` mensagens e dispara cada uma sem esperar
   * o fim. Nunca rejeita; os slots são reservados antes do claim para ticks sobrepostos não passarem do limite.
   */
  async tick(): Promise<void> {
    const limit = MAX_IN_FLIGHT - this.inFlight
    if (limit <= 0) return
    this.inFlight += limit
    let claimed = 0
    try {
      const now = this.clock.now()
      const staleBefore = new Date(now.getTime() - CLAIM_TTL_MS)
      const claims = await this.claimer.claimDue({ now, staleBefore, limit })
      claimed = claims.length
      claims.forEach((claim) => this.dispatch(claim))
    } catch {
      // Falha de claim não derruba o loop: o próximo tick tenta de novo.
    } finally {
      this.inFlight -= limit - claimed
    }
  }

  /** Começa a rodar `tick` a cada `pollIntervalMs`; não faz nada se já iniciado. */
  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs)
  }

  /** Para o intervalo; não faz nada se não iniciado. */
  stop(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Processa uma mensagem sem esperar e libera o slot quando ela termina, com sucesso ou erro.
   * @param claim Mensagem já contada em voo.
   */
  private dispatch(claim: ClaimedMessage): void {
    Promise.resolve()
      .then(() => this.processor.execute(claim))
      .catch(() => {
        // Sem logger no Marco 3: o claim obsoleto de 30 s devolve a mensagem à fila.
      })
      .finally(() => {
        this.inFlight -= 1
      })
  }
}
