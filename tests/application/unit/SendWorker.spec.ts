import { SendWorker } from '../../../src/application/SendWorker'
import type { ClaimedMessage } from '../../../src/ports/campaignRepository'
import { CLAIM_TTL_MS } from '../../../src/domain/rules'
import { MAX_IN_FLIGHT } from '../../../src/application/workerConfig'
import { FakeClock, FakeDueMessageClaim, createDeferred, flushMicrotasks, makeClaim } from '../../helpers/fakes'

const NOW = new Date('2026-11-02T12:00:00.000Z')

/**
 * Processador fake: cada `execute` fica pendente até o teste resolver ou rejeitar a sua promessa.
 */
class ControllableProcessor {
  readonly claims: ClaimedMessage[] = []
  private readonly pending: Array<ReturnType<typeof createDeferred<void>>> = []

  /**
   * Registra a mensagem e devolve uma promessa que só termina quando o teste mandar.
   * @param claim Mensagem recebida.
   */
  execute(claim: ClaimedMessage): Promise<void> {
    this.claims.push(claim)
    const deferred = createDeferred<void>()
    this.pending.push(deferred)
    return deferred.promise
  }

  /** Resolve todas as execuções pendentes. */
  resolveAll(): void {
    this.pending.splice(0).forEach((deferred) => deferred.resolve())
  }

  /**
   * Rejeita todas as execuções pendentes.
   * @param reason Motivo da rejeição.
   */
  rejectAll(reason: unknown): void {
    this.pending.splice(0).forEach((deferred) => deferred.reject(reason))
  }
}

/**
 * Cria `n` mensagens reivindicadas com ids distintos.
 * @param n Quantidade.
 */
function claims(n: number): ClaimedMessage[] {
  return Array.from({ length: n }, (_, i) => makeClaim({ messageId: i + 1 }))
}

describe('SendWorker.tick', () => {
  it('reivindica com limite 5 - emVoo e staleBefore = now - 30000', async () => {
    const claimer = new FakeDueMessageClaim([])
    const worker = new SendWorker(claimer, new FakeClock(NOW), new ControllableProcessor())
    await worker.tick()
    expect(claimer.calls).toEqual([
      { now: NOW, staleBefore: new Date(NOW.getTime() - CLAIM_TTL_MS), limit: MAX_IN_FLIGHT },
    ])
    expect(CLAIM_TTL_MS).toBe(30_000)
    expect(MAX_IN_FLIGHT).toBe(5)
  })

  it('despacha cada mensagem reivindicada para o processador', async () => {
    const batch = claims(3)
    const processor = new ControllableProcessor()
    const worker = new SendWorker(new FakeDueMessageClaim([batch]), new FakeClock(NOW), processor)
    await worker.tick()
    await flushMicrotasks()
    expect(processor.claims).toEqual(batch)
  })

  it('não espera o fim do processamento: tick termina com as mensagens ainda em voo', async () => {
    const processor = new ControllableProcessor()
    const worker = new SendWorker(new FakeDueMessageClaim([claims(2)]), new FakeClock(NOW), processor)
    await expect(worker.tick()).resolves.toBeUndefined()
  })

  it('não reivindica quando já há 5 em voo', async () => {
    const claimer = new FakeDueMessageClaim([claims(5)])
    const worker = new SendWorker(claimer, new FakeClock(NOW), new ControllableProcessor())
    await worker.tick()
    await worker.tick()
    expect(claimer.calls).toHaveLength(1)
  })

  it('reivindica só os slots livres quando há mensagens em voo', async () => {
    const claimer = new FakeDueMessageClaim([claims(3), []])
    const worker = new SendWorker(claimer, new FakeClock(NOW), new ControllableProcessor())
    await worker.tick()
    await worker.tick()
    expect(claimer.calls.map((call) => call.limit)).toEqual([5, 2])
  })

  it('devolve ao limite os slots reservados e não usados quando o claim traz menos mensagens', async () => {
    const claimer = new FakeDueMessageClaim([claims(2), []])
    const worker = new SendWorker(claimer, new FakeClock(NOW), new ControllableProcessor())
    await worker.tick()
    await worker.tick()
    expect(claimer.calls.map((call) => call.limit)).toEqual([5, 3])
  })

  it('libera os slots quando o processamento termina com sucesso', async () => {
    const processor = new ControllableProcessor()
    const claimer = new FakeDueMessageClaim([claims(5), []])
    const worker = new SendWorker(claimer, new FakeClock(NOW), processor)
    await worker.tick()
    await flushMicrotasks()
    processor.resolveAll()
    await flushMicrotasks()
    await worker.tick()
    expect(claimer.calls.map((call) => call.limit)).toEqual([5, 5])
  })

  it('um execute rejeitado não rejeita o tick e libera o slot', async () => {
    const processor = new ControllableProcessor()
    const claimer = new FakeDueMessageClaim([claims(5), []])
    const worker = new SendWorker(claimer, new FakeClock(NOW), processor)
    await expect(worker.tick()).resolves.toBeUndefined()
    await flushMicrotasks()
    processor.rejectAll(new Error('falha no processamento'))
    await flushMicrotasks()
    await expect(worker.tick()).resolves.toBeUndefined()
    expect(claimer.calls.map((call) => call.limit)).toEqual([5, 5])
  })

  it('um execute que lança de forma síncrona também não rejeita o tick', async () => {
    const throwing = {
      execute: (): Promise<void> => {
        throw new Error('lançou direto')
      },
    }
    const worker = new SendWorker(new FakeDueMessageClaim([claims(2)]), new FakeClock(NOW), throwing)
    await expect(worker.tick()).resolves.toBeUndefined()
    await flushMicrotasks()
  })

  it('claimDue rejeitado não rejeita o tick e devolve os slots reservados', async () => {
    const failing = new FakeDueMessageClaim([], new Error('db fora do ar'))
    const worker = new SendWorker(failing, new FakeClock(NOW), new ControllableProcessor())
    await expect(worker.tick()).resolves.toBeUndefined()
    await worker.tick()
    expect(failing.calls.map((call) => call.limit)).toEqual([5, 5])
  })
})

describe('SendWorker.start e stop', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('start roda tick a cada pollIntervalMs e stop interrompe', async () => {
    const claimer = new FakeDueMessageClaim([])
    const worker = new SendWorker(claimer, new FakeClock(NOW), new ControllableProcessor(), 50)
    worker.start()
    jest.advanceTimersByTime(50)
    expect(claimer.calls).toHaveLength(1)
    // O tick anterior precisa terminar para devolver os slots reservados antes do próximo.
    await flushMicrotasks()
    jest.advanceTimersByTime(50)
    expect(claimer.calls).toHaveLength(2)
    worker.stop()
    await flushMicrotasks()
    jest.advanceTimersByTime(500)
    expect(claimer.calls).toHaveLength(2)
  })

  it('chamar start duas vezes não cria um segundo intervalo', async () => {
    const claimer = new FakeDueMessageClaim([])
    const worker = new SendWorker(claimer, new FakeClock(NOW), new ControllableProcessor(), 50)
    worker.start()
    worker.start()
    jest.advanceTimersByTime(50)
    expect(claimer.calls).toHaveLength(1)
    worker.stop()
    await flushMicrotasks()
  })

  it('stop sem start não faz nada', () => {
    const worker = new SendWorker(new FakeDueMessageClaim([]), new FakeClock(NOW), new ControllableProcessor())
    expect(() => worker.stop()).not.toThrow()
  })
})
