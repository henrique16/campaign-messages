import { ProcessClaimedMessage } from '../../../src/application/ProcessClaimedMessage'
import { classifyProviderError } from '../../../src/domain/providerFailure'
import type { ProviderErrorClassifier } from '../../../src/domain/providerFailure'
import { decideAfterTransient } from '../../../src/domain/retryPolicy'
import type { RetryPolicy } from '../../../src/domain/retryPolicy'
import {
  FakeClock,
  FakeFinishIfDone,
  FakeMessageOutcomeStore,
  makeClaim,
  providerThatSends,
  providerThatThrows,
} from '../../helpers/fakes'
import type { EventLog, FakeMessageProvider } from '../../helpers/fakes'

const NOW = new Date('2026-11-02T12:00:00.000Z')

/**
 * Monta o `ProcessClaimedMessage` com fakes e um log de ordem compartilhado.
 * @param provider Provedor fake.
 * @param overrides Classificador e política de retry, quando o teste quer trocar os reais.
 * @param failOutcomesWith Quando definido, as gravações do repositório rejeitam com este erro.
 */
function build(
  provider: FakeMessageProvider,
  overrides: { classify?: ProviderErrorClassifier; policy?: RetryPolicy } = {},
  failOutcomesWith?: Error,
) {
  const log: EventLog = []
  const outcomes = new FakeMessageOutcomeStore(log, failOutcomesWith)
  const finish = new FakeFinishIfDone(log)
  const processor = new ProcessClaimedMessage(
    provider,
    overrides.classify ?? classifyProviderError,
    overrides.policy ?? decideAfterTransient,
    new FakeClock(NOW),
    outcomes,
    finish,
  )
  return { processor, outcomes, finish, log }
}

describe('ProcessClaimedMessage', () => {
  describe('envio com sucesso', () => {
    it('envia ao provedor o telefone e o corpo da mensagem reivindicada', async () => {
      const provider = providerThatSends()
      const { processor } = build(provider)
      await processor.execute(makeClaim({ phone: '5511900000001', body: 'Olá Beto' }))
      expect(provider.calls).toEqual([{ to: '5511900000001', body: 'Olá Beto' }])
    })

    it('grava sent com o id do provedor e depois avalia o encerramento da campanha', async () => {
      const { processor, outcomes, finish, log } = build(providerThatSends('prov-77'))
      await processor.execute(makeClaim({ messageId: 10, campaignId: 3 }))
      expect(outcomes.sent).toEqual([{ messageId: 10, providerMessageId: 'prov-77' }])
      expect(finish.calls).toEqual([3])
      expect(log).toEqual(['sent:10', 'finish:3'])
    })
  })

  describe('falha permanente', () => {
    it('400 invalid_number grava failed com invalid_number e depois avalia o encerramento', async () => {
      const { processor, outcomes, finish, log } = build(
        providerThatThrows({ status: 400, message: 'invalid_number' }),
      )
      await processor.execute(makeClaim({ messageId: 11, campaignId: 4 }))
      expect(outcomes.failed).toEqual([{ messageId: 11, reason: 'invalid_number' }])
      expect(outcomes.retries).toHaveLength(0)
      expect(finish.calls).toEqual([4])
      expect(log).toEqual(['failed:11', 'finish:4'])
    })

    it('400 com outra mensagem grava failed com invalid_payload', async () => {
      const { processor, outcomes, log } = build(providerThatThrows({ status: 400, message: 'xpto' }))
      await processor.execute(makeClaim({ messageId: 12, campaignId: 4 }))
      expect(outcomes.failed).toEqual([{ messageId: 12, reason: 'invalid_payload' }])
      expect(log).toEqual(['failed:12', 'finish:4'])
    })

    it('falha permanente não depende de attemptCount: não reagenda mesmo na primeira tentativa', async () => {
      const { processor, outcomes } = build(providerThatThrows({ status: 400, message: 'invalid_number' }))
      await processor.execute(makeClaim({ attemptCount: 0 }))
      expect(outcomes.retries).toHaveLength(0)
    })
  })

  describe('falha transitória com retry', () => {
    it.each([
      [0, 1, 200],
      [1, 2, 800],
      [2, 3, 2000],
    ])(
      'attemptCount %i grava retry com attemptCount %i e próximo horário em now + %i ms',
      async (attemptCount, nextAttemptCount, delayMs) => {
        const { processor, outcomes } = build(providerThatThrows(new Error('timeout')))
        await processor.execute(makeClaim({ messageId: 13, attemptCount }))
        expect(outcomes.retries).toEqual([
          {
            messageId: 13,
            attemptCount: nextAttemptCount,
            nextAttemptAt: new Date(NOW.getTime() + delayMs),
          },
        ])
      },
    )

    it('retry não grava sent nem failed e não avalia o encerramento da campanha', async () => {
      const { processor, outcomes, finish, log } = build(providerThatThrows({ status: 503 }))
      await processor.execute(makeClaim({ messageId: 14, attemptCount: 1 }))
      expect(outcomes.sent).toHaveLength(0)
      expect(outcomes.failed).toHaveLength(0)
      expect(finish.calls).toHaveLength(0)
      expect(log).toEqual(['retry:14'])
    })

    it('valor lançado que não é objeto (string) também é transitório e reagenda', async () => {
      const { processor, outcomes } = build(providerThatThrows('falha de rede'))
      await processor.execute(makeClaim({ attemptCount: 0 }))
      expect(outcomes.retries).toHaveLength(1)
    })
  })

  describe('falha transitória esgotada', () => {
    it('quando a política manda falhar grava failed com provider_unavailable e depois avalia o encerramento', async () => {
      const { processor, outcomes, finish, log } = build(providerThatThrows(new Error('timeout')))
      await processor.execute(makeClaim({ messageId: 15, campaignId: 5, attemptCount: 3 }))
      expect(outcomes.failed).toEqual([{ messageId: 15, reason: 'provider_unavailable' }])
      expect(outcomes.retries).toHaveLength(0)
      expect(finish.calls).toEqual([5])
      expect(log).toEqual(['failed:15', 'finish:5'])
    })
  })

  describe('dependências injetadas', () => {
    it('usa o classificador injetado com o valor lançado pelo provedor', async () => {
      const thrown = new Error('boom')
      const seen: unknown[] = []
      const classify: ProviderErrorClassifier = (err) => {
        seen.push(err)
        return { kind: 'permanent', reason: 'invalid_payload' }
      }
      const { processor, outcomes } = build(providerThatThrows(thrown), { classify })
      await processor.execute(makeClaim({ messageId: 16 }))
      expect(seen).toEqual([thrown])
      expect(outcomes.failed).toEqual([{ messageId: 16, reason: 'invalid_payload' }])
    })

    it('usa a política de retry injetada com o attemptCount da mensagem', async () => {
      const attempts: number[] = []
      const policy: RetryPolicy = (attemptCount) => {
        attempts.push(attemptCount)
        return { kind: 'retry', delayMs: 5 }
      }
      const { processor, outcomes } = build(providerThatThrows(new Error('x')), { policy })
      await processor.execute(makeClaim({ messageId: 17, attemptCount: 2 }))
      expect(attempts).toEqual([2])
      expect(outcomes.retries).toEqual([
        { messageId: 17, attemptCount: 3, nextAttemptAt: new Date(NOW.getTime() + 5) },
      ])
    })
  })

  describe('erro do repositório', () => {
    it('rejeita quando a gravação falha e não avalia o encerramento', async () => {
      const { processor, finish } = build(providerThatSends(), {}, new Error('db fora do ar'))
      await expect(processor.execute(makeClaim())).rejects.toThrow('db fora do ar')
      expect(finish.calls).toHaveLength(0)
    })
  })
})
