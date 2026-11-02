import type { ApplyProviderWebhook } from '../application/ApplyProviderWebhook'
import type { CreateCampaign } from '../application/CreateCampaign'
import type { GetCampaign } from '../application/GetCampaign'
import type { ListCampaignFailures } from '../application/ListCampaignFailures'
import type { StartCampaign } from '../application/StartCampaign'
import {
  badRequest,
  mapApplyProviderWebhook,
  mapCreateCampaign,
  mapGetCampaign,
  mapListCampaignFailures,
  mapStartCampaign,
} from './httpMapping'
import type { EmptyBody, HttpResponse } from './httpMapping'

export type CreateCampaignUseCase = Pick<CreateCampaign, 'execute'>
export type StartCampaignUseCase = Pick<StartCampaign, 'execute'>
export type GetCampaignUseCase = Pick<GetCampaign, 'execute'>
export type ListCampaignFailuresUseCase = Pick<ListCampaignFailures, 'execute'>
export type ApplyProviderWebhookUseCase = Pick<ApplyProviderWebhook, 'execute'>

const CAMPAIGN_ID_PATTERN = /^[1-9][0-9]*$/

/**
 * Converte o `:id` do caminho em número. É parse de transporte: só aceita inteiro
 * positivo sem zero à esquerda e dentro do intervalo seguro de inteiros.
 * @param rawId Valor bruto do parâmetro de caminho.
 * @returns O id, ou `null` quando malformado.
 */
export function parseCampaignId(rawId: unknown): number | null {
  if (typeof rawId !== 'string' || !CAMPAIGN_ID_PATTERN.test(rawId)) return null
  const id = Number(rawId)
  return Number.isSafeInteger(id) ? id : null
}

/**
 * Valida o id do caminho e só então executa a ação; id malformado responde 400
 * sem chamar o caso de uso.
 * @param rawId Valor bruto do parâmetro de caminho.
 * @param run Ação que recebe o id já convertido.
 */
async function withCampaignId<TBody>(
  rawId: unknown,
  run: (campaignId: number) => Promise<HttpResponse<TBody>>,
): Promise<HttpResponse<TBody | EmptyBody>> {
  const campaignId = parseCampaignId(rawId)
  if (campaignId === null) return badRequest()
  return run(campaignId)
}

/**
 * Handler de `POST /campaigns`.
 * @param useCase Caso de uso de criação.
 * @param rawBody Corpo da requisição, repassado sem alteração.
 */
export async function handleCreateCampaign(useCase: CreateCampaignUseCase, rawBody: unknown) {
  return mapCreateCampaign(await useCase.execute(rawBody))
}

/**
 * Handler de `POST /campaigns/:id/start`.
 * @param useCase Caso de uso de início.
 * @param rawId Valor bruto de `:id`.
 */
export function handleStartCampaign(useCase: StartCampaignUseCase, rawId: unknown) {
  return withCampaignId(rawId, async (campaignId) => mapStartCampaign(await useCase.execute(campaignId)))
}

/**
 * Handler de `GET /campaigns/:id`.
 * @param useCase Caso de uso de consulta.
 * @param rawId Valor bruto de `:id`.
 */
export function handleGetCampaign(useCase: GetCampaignUseCase, rawId: unknown) {
  return withCampaignId(rawId, async (campaignId) => mapGetCampaign(await useCase.execute(campaignId)))
}

/**
 * Handler de `GET /campaigns/:id/failures`.
 * @param useCase Caso de uso de listagem de falhas.
 * @param rawId Valor bruto de `:id`.
 * @param rawPage Valor bruto de `req.query.page`, repassado sem alteração (`undefined` quando ausente).
 */
export function handleListCampaignFailures(
  useCase: ListCampaignFailuresUseCase,
  rawId: unknown,
  rawPage: unknown,
) {
  return withCampaignId(rawId, async (campaignId) =>
    mapListCampaignFailures(await useCase.execute(campaignId, rawPage)),
  )
}

/**
 * Handler de `POST /webhooks/provider`.
 * @param useCase Caso de uso do webhook.
 * @param rawBody Corpo da requisição, repassado sem alteração.
 */
export async function handleProviderWebhook(useCase: ApplyProviderWebhookUseCase, rawBody: unknown) {
  return mapApplyProviderWebhook(await useCase.execute(rawBody))
}
