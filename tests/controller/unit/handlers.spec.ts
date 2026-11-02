import type { ApplyProviderWebhookResult } from '../../../src/application/ApplyProviderWebhook'
import type { CreateCampaignResult } from '../../../src/application/CreateCampaign'
import type { GetCampaignResult } from '../../../src/application/GetCampaign'
import type { ListCampaignFailuresResult } from '../../../src/application/ListCampaignFailures'
import type { StartCampaignResult } from '../../../src/application/StartCampaign'
import {
  handleCreateCampaign,
  handleGetCampaign,
  handleListCampaignFailures,
  handleProviderWebhook,
  handleStartCampaign,
  parseCampaignId,
} from '../../../src/controller/handlers'
import { stubUseCase } from '../../helpers/fakes'

const MALFORMED_IDS = ['0', '07', 'abc', '-1', '1.5', '', ' 1', '1 ', '1e3', '9007199254740992', '99999999999999999999']

describe('parseCampaignId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['10', 10],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('aceita o id %p e devolve %p', (raw, expected) => {
    expect(parseCampaignId(raw)).toBe(expected)
  })

  it.each(MALFORMED_IDS.map((id) => [id]))('rejeita o id malformado %p', (raw) => {
    expect(parseCampaignId(raw)).toBeNull()
  })

  it('rejeita id acima de MAX_SAFE_INTEGER', () => {
    expect(parseCampaignId(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull()
    expect(parseCampaignId(String(Number.MAX_SAFE_INTEGER + 2))).toBeNull()
  })

  it.each([[undefined], [null], [7], [['7']], [{}]])('rejeita valor que não é string (%p)', (raw) => {
    expect(parseCampaignId(raw)).toBeNull()
  })
})

describe('handleCreateCampaign', () => {
  it('invalid vira 400 com corpo vazio', async () => {
    const useCase = stubUseCase<[unknown], CreateCampaignResult>({ kind: 'invalid' })
    expect(await handleCreateCampaign(useCase, {})).toEqual({ status: 400, body: {} })
  })

  it('created vira 201 com id, accepted e rejected, sem kind', async () => {
    const rejected = [{ phone: '123', reason: 'invalid_number' as const }]
    const useCase = stubUseCase<[unknown], CreateCampaignResult>({ kind: 'created', id: 8, accepted: 2, rejected })
    const response = await handleCreateCampaign(useCase, {})
    expect(response).toEqual({ status: 201, body: { id: 8, accepted: 2, rejected } })
    expect(response.body).not.toHaveProperty('kind')
  })

  it('repassa o corpo bruto ao caso de uso sem alterar', async () => {
    const body = { template: 'Oi', contacts: [] }
    const useCase = stubUseCase<[unknown], CreateCampaignResult>({ kind: 'invalid' })
    await handleCreateCampaign(useCase, body)
    expect(useCase.calls).toHaveLength(1)
    expect(useCase.calls[0][0]).toBe(body)
  })
})

describe('handleStartCampaign', () => {
  it('converte o id e chama o caso de uso com o número', async () => {
    const useCase = stubUseCase<[number], StartCampaignResult>({ kind: 'status', status: 'running' })
    await handleStartCampaign(useCase, '12')
    expect(useCase.calls).toEqual([[12]])
  })

  it('not_found vira 404 com corpo vazio', async () => {
    const useCase = stubUseCase<[number], StartCampaignResult>({ kind: 'not_found' })
    expect(await handleStartCampaign(useCase, '12')).toEqual({ status: 404, body: {} })
  })

  it('status running vira 202 com { status }', async () => {
    const useCase = stubUseCase<[number], StartCampaignResult>({ kind: 'status', status: 'running' })
    expect(await handleStartCampaign(useCase, '12')).toEqual({ status: 202, body: { status: 'running' } })
  })

  it('status finished vira 202 com { status }', async () => {
    const useCase = stubUseCase<[number], StartCampaignResult>({ kind: 'status', status: 'finished' })
    expect(await handleStartCampaign(useCase, '12')).toEqual({ status: 202, body: { status: 'finished' } })
  })

  it.each(MALFORMED_IDS.map((id) => [id]))('id malformado %p vira 400 e não chama o caso de uso', async (rawId) => {
    const useCase = stubUseCase<[number], StartCampaignResult>({ kind: 'status', status: 'running' })
    expect(await handleStartCampaign(useCase, rawId)).toEqual({ status: 400, body: {} })
    expect(useCase.calls).toHaveLength(0)
  })

  it('id que não é string vira 400 e não chama o caso de uso', async () => {
    const useCase = stubUseCase<[number], StartCampaignResult>({ kind: 'status', status: 'running' })
    expect(await handleStartCampaign(useCase, undefined)).toEqual({ status: 400, body: {} })
    expect(useCase.calls).toHaveLength(0)
  })
})

describe('handleGetCampaign', () => {
  const totals = { queued: 1, sent: 2, delivered: 3, read: 4, failed: 5 }

  it('not_found vira 404 com corpo vazio', async () => {
    const useCase = stubUseCase<[number], GetCampaignResult>({ kind: 'not_found' })
    expect(await handleGetCampaign(useCase, '5')).toEqual({ status: 404, body: {} })
    expect(useCase.calls).toEqual([[5]])
  })

  it('ok vira 200 com id, status e totais, sem kind', async () => {
    const useCase = stubUseCase<[number], GetCampaignResult>({ kind: 'ok', id: 5, status: 'running', totals })
    const response = await handleGetCampaign(useCase, '5')
    expect(response).toEqual({ status: 200, body: { id: 5, status: 'running', totals } })
    expect(response.body).not.toHaveProperty('kind')
  })

  it.each(MALFORMED_IDS.map((id) => [id]))('id malformado %p vira 400 e não chama o caso de uso', async (rawId) => {
    const useCase = stubUseCase<[number], GetCampaignResult>({ kind: 'not_found' })
    expect(await handleGetCampaign(useCase, rawId)).toEqual({ status: 400, body: {} })
    expect(useCase.calls).toHaveLength(0)
  })
})

describe('handleListCampaignFailures', () => {
  it('invalid vira 400 com corpo vazio', async () => {
    const useCase = stubUseCase<[number, unknown], ListCampaignFailuresResult>({ kind: 'invalid' })
    expect(await handleListCampaignFailures(useCase, '5', '0')).toEqual({ status: 400, body: {} })
  })

  it('not_found vira 404 com corpo vazio', async () => {
    const useCase = stubUseCase<[number, unknown], ListCampaignFailuresResult>({ kind: 'not_found' })
    expect(await handleListCampaignFailures(useCase, '5', undefined)).toEqual({ status: 404, body: {} })
  })

  it('ok vira 200 com items, page, pageSize e total, sem kind', async () => {
    const items = [{ phone: '5511912345678', reason: 'invalid_number' }]
    const useCase = stubUseCase<[number, unknown], ListCampaignFailuresResult>({
      kind: 'ok',
      items,
      page: 2,
      pageSize: 50,
      total: 51,
    })
    const response = await handleListCampaignFailures(useCase, '5', '2')
    expect(response).toEqual({ status: 200, body: { items, page: 2, pageSize: 50, total: 51 } })
    expect(response.body).not.toHaveProperty('kind')
  })

  it('repassa o id convertido e o page bruto sem alterar', async () => {
    const useCase = stubUseCase<[number, unknown], ListCampaignFailuresResult>({ kind: 'not_found' })
    await handleListCampaignFailures(useCase, '5', '2')
    await handleListCampaignFailures(useCase, '6', undefined)
    expect(useCase.calls).toEqual([
      [5, '2'],
      [6, undefined],
    ])
  })

  it.each(MALFORMED_IDS.map((id) => [id]))('id malformado %p vira 400 e não chama o caso de uso', async (rawId) => {
    const useCase = stubUseCase<[number, unknown], ListCampaignFailuresResult>({ kind: 'not_found' })
    expect(await handleListCampaignFailures(useCase, rawId, '1')).toEqual({ status: 400, body: {} })
    expect(useCase.calls).toHaveLength(0)
  })
})

describe('handleProviderWebhook', () => {
  it('invalid vira 400 com corpo vazio', async () => {
    const useCase = stubUseCase<[unknown], ApplyProviderWebhookResult>({ kind: 'invalid' })
    expect(await handleProviderWebhook(useCase, {})).toEqual({ status: 400, body: {} })
  })

  it('ok vira 200 com corpo vazio', async () => {
    const useCase = stubUseCase<[unknown], ApplyProviderWebhookResult>({ kind: 'ok' })
    expect(await handleProviderWebhook(useCase, {})).toEqual({ status: 200, body: {} })
  })

  it('repassa o corpo bruto ao caso de uso sem alterar', async () => {
    const body = { event_id: 'evt-1' }
    const useCase = stubUseCase<[unknown], ApplyProviderWebhookResult>({ kind: 'ok' })
    await handleProviderWebhook(useCase, body)
    expect(useCase.calls[0][0]).toBe(body)
  })
})
