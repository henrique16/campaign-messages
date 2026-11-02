import express from 'express'
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express'
import {
  handleCreateCampaign,
  handleGetCampaign,
  handleListCampaignFailures,
  handleProviderWebhook,
  handleStartCampaign,
} from './handlers'
import type {
  ApplyProviderWebhookUseCase,
  CreateCampaignUseCase,
  GetCampaignUseCase,
  ListCampaignFailuresUseCase,
  StartCampaignUseCase,
} from './handlers'
import { badRequest } from './httpMapping'
import type { HttpResponse } from './httpMapping'

/** Os cinco casos de uso que `createApp` liga às rotas. */
export interface ControllerUseCases {
  createCampaign: CreateCampaignUseCase
  startCampaign: StartCampaignUseCase
  getCampaign: GetCampaignUseCase
  listCampaignFailures: ListCampaignFailuresUseCase
  applyProviderWebhook: ApplyProviderWebhookUseCase
}

/**
 * Envia a resposta como JSON (`Content-Type: application/json`).
 * @param res Resposta do Express.
 * @param response Status e corpo já decididos pelo handler.
 */
function sendJson(res: Response, response: HttpResponse<unknown>): void {
  res.status(response.status).json(response.body)
}

/**
 * Adapta um handler de transporte (`Request` -> `HttpResponse`) para um `RequestHandler`
 * do Express que serializa o resultado com `sendJson`. Rejeições seguem para o tratador
 * de erros do Express.
 * @param handle Função que decide status e corpo a partir da requisição.
 * @returns Handler pronto para registrar em `app.get` / `app.post`.
 */
function toRoute(handle: (req: Request) => Promise<HttpResponse<unknown>>): RequestHandler {
  return async (req, res) => {
    sendJson(res, await handle(req))
  }
}

/**
 * Converte somente a falha de parse do `express.json()` em 400 `{}`; qualquer outro
 * erro segue para o tratador padrão do Express.
 * @param err Erro recebido pelo Express.
 * @param _req Requisição (não usada).
 * @param res Resposta do Express.
 * @param next Repassa erros que não são de parse de JSON.
 */
const jsonParseErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    sendJson(res, badRequest())
    return
  }
  next(err)
}

/**
 * Monta o app Express com as cinco rotas. Não chama `listen`; quem sobe o servidor é o `main`.
 * @param useCases Casos de uso (ou objetos com `execute` de mesma assinatura).
 * @returns App Express pronto para ser servido.
 */
export function createApp(useCases: ControllerUseCases): express.Express {
  const app = express()
  app.use(express.json())

  app.post('/campaigns', toRoute((req) => handleCreateCampaign(useCases.createCampaign, req.body)))
  app.post('/campaigns/:id/start', toRoute((req) => handleStartCampaign(useCases.startCampaign, req.params.id)))
  app.get('/campaigns/:id', toRoute((req) => handleGetCampaign(useCases.getCampaign, req.params.id)))
  app.get(
    '/campaigns/:id/failures',
    toRoute((req) => handleListCampaignFailures(useCases.listCampaignFailures, req.params.id, req.query.page)),
  )
  app.post('/webhooks/provider', toRoute((req) => handleProviderWebhook(useCases.applyProviderWebhook, req.body)))
  app.use(jsonParseErrorHandler)

  return app
}
