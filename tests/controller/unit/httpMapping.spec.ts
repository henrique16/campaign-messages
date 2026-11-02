import {
  badRequest,
  mapApplyProviderWebhook,
  mapCreateCampaign,
  mapGetCampaign,
  mapListCampaignFailures,
  mapStartCampaign,
} from '../../../src/controller/httpMapping'

describe('badRequest', () => {
  it('devolve 400 com corpo vazio', () => {
    expect(badRequest()).toEqual({ status: 400, body: {} })
  })

  it('devolve um objeto novo a cada chamada', () => {
    const first = badRequest()
    const second = badRequest()
    expect(first).not.toBe(second)
    expect(first.body).not.toBe(second.body)
  })
})

describe('mapCreateCampaign', () => {
  it('invalid vira 400 com corpo vazio', () => {
    expect(mapCreateCampaign({ kind: 'invalid' })).toEqual({ status: 400, body: {} })
  })

  it('created vira 201 com id, accepted e rejected, sem kind', () => {
    const rejected = [{ phone: '1', reason: 'invalid_number' as const }]
    const response = mapCreateCampaign({ kind: 'created', id: 3, accepted: 0, rejected })
    expect(response).toEqual({ status: 201, body: { id: 3, accepted: 0, rejected } })
    expect(Object.keys(response.body)).toEqual(['id', 'accepted', 'rejected'])
  })
})

describe('mapStartCampaign', () => {
  it('not_found vira 404 com corpo vazio', () => {
    expect(mapStartCampaign({ kind: 'not_found' })).toEqual({ status: 404, body: {} })
  })

  it.each(['running', 'finished'] as const)('status %s vira 202 com { status }', (status) => {
    expect(mapStartCampaign({ kind: 'status', status })).toEqual({ status: 202, body: { status } })
  })
})

describe('mapGetCampaign', () => {
  it('not_found vira 404 com corpo vazio', () => {
    expect(mapGetCampaign({ kind: 'not_found' })).toEqual({ status: 404, body: {} })
  })

  it('ok vira 200 com id, status e totais, sem kind', () => {
    const totals = { queued: 0, sent: 1, delivered: 0, read: 0, failed: 0 }
    const response = mapGetCampaign({ kind: 'ok', id: 9, status: 'finished', totals })
    expect(response).toEqual({ status: 200, body: { id: 9, status: 'finished', totals } })
    expect(Object.keys(response.body)).toEqual(['id', 'status', 'totals'])
  })
})

describe('mapListCampaignFailures', () => {
  it('invalid vira 400 com corpo vazio', () => {
    expect(mapListCampaignFailures({ kind: 'invalid' })).toEqual({ status: 400, body: {} })
  })

  it('not_found vira 404 com corpo vazio', () => {
    expect(mapListCampaignFailures({ kind: 'not_found' })).toEqual({ status: 404, body: {} })
  })

  it('ok vira 200 com items, page, pageSize e total, sem kind', () => {
    const items = [{ phone: '5511912345678', reason: 'provider_unavailable' }]
    const response = mapListCampaignFailures({ kind: 'ok', items, page: 1, pageSize: 50, total: 1 })
    expect(response).toEqual({ status: 200, body: { items, page: 1, pageSize: 50, total: 1 } })
    expect(Object.keys(response.body)).toEqual(['items', 'page', 'pageSize', 'total'])
  })
})

describe('mapApplyProviderWebhook', () => {
  it('invalid vira 400 com corpo vazio', () => {
    expect(mapApplyProviderWebhook({ kind: 'invalid' })).toEqual({ status: 400, body: {} })
  })

  it('ok vira 200 com corpo vazio', () => {
    expect(mapApplyProviderWebhook({ kind: 'ok' })).toEqual({ status: 200, body: {} })
  })
})
