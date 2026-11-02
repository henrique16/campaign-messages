import type { ApplyProviderWebhookResult } from '../application/ApplyProviderWebhook'
import type { CreateCampaignResult } from '../application/CreateCampaign'
import type { GetCampaignResult } from '../application/GetCampaign'
import type { ListCampaignFailuresResult } from '../application/ListCampaignFailures'
import type { StartCampaignResult } from '../application/StartCampaign'

/** Corpo vazio (`{}`) usado em 400, 404 e no 200 do webhook. */
export type EmptyBody = Record<string, never>

/** Resposta HTTP sem dependência de Express: status e corpo JSON. */
export interface HttpResponse<TBody> {
  status: number
  body: TBody
}

type CreatedBody = Omit<Extract<CreateCampaignResult, { kind: 'created' }>, 'kind'>
type StatusBody = { status: Extract<StartCampaignResult, { kind: 'status' }>['status'] }
type CampaignBody = Omit<Extract<GetCampaignResult, { kind: 'ok' }>, 'kind'>
type FailuresBody = Omit<Extract<ListCampaignFailuresResult, { kind: 'ok' }>, 'kind'>

/**
 * Resposta 400 com corpo vazio. Também usada pelo transporte para id de caminho
 * malformado e JSON malformado.
 * @returns Nova resposta `{ status: 400, body: {} }`.
 */
export function badRequest(): HttpResponse<EmptyBody> {
  return { status: 400, body: {} }
}

/**
 * Resposta 404 com corpo vazio.
 * @returns Nova resposta `{ status: 404, body: {} }`.
 */
function notFound(): HttpResponse<EmptyBody> {
  return { status: 404, body: {} }
}

/**
 * Traduz o resultado de `CreateCampaign` em HTTP: `invalid` vira 400, `created` vira 201.
 * @param result Resultado do caso de uso.
 */
export function mapCreateCampaign(result: CreateCampaignResult): HttpResponse<EmptyBody | CreatedBody> {
  if (result.kind === 'invalid') return badRequest()
  return { status: 201, body: { id: result.id, accepted: result.accepted, rejected: result.rejected } }
}

/**
 * Traduz o resultado de `StartCampaign` em HTTP: `not_found` vira 404, `status` vira 202
 * com o status devolvido pelo caso de uso.
 * @param result Resultado do caso de uso.
 */
export function mapStartCampaign(result: StartCampaignResult): HttpResponse<EmptyBody | StatusBody> {
  if (result.kind === 'not_found') return notFound()
  return { status: 202, body: { status: result.status } }
}

/**
 * Traduz o resultado de `GetCampaign` em HTTP: `not_found` vira 404, `ok` vira 200.
 * @param result Resultado do caso de uso.
 */
export function mapGetCampaign(result: GetCampaignResult): HttpResponse<EmptyBody | CampaignBody> {
  if (result.kind === 'not_found') return notFound()
  return { status: 200, body: { id: result.id, status: result.status, totals: result.totals } }
}

/**
 * Traduz o resultado de `ListCampaignFailures` em HTTP: `invalid` vira 400,
 * `not_found` vira 404, `ok` vira 200.
 * @param result Resultado do caso de uso.
 */
export function mapListCampaignFailures(
  result: ListCampaignFailuresResult,
): HttpResponse<EmptyBody | FailuresBody> {
  if (result.kind === 'invalid') return badRequest()
  if (result.kind === 'not_found') return notFound()
  return {
    status: 200,
    body: { items: result.items, page: result.page, pageSize: result.pageSize, total: result.total },
  }
}

/**
 * Traduz o resultado de `ApplyProviderWebhook` em HTTP: `invalid` vira 400, `ok` vira 200.
 * @param result Resultado do caso de uso.
 */
export function mapApplyProviderWebhook(result: ApplyProviderWebhookResult): HttpResponse<EmptyBody> {
  if (result.kind === 'invalid') return badRequest()
  return { status: 200, body: {} }
}
