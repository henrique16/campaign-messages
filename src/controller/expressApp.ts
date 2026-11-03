import express from 'express'
import multer from 'multer'
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
import { badRequest, tooManyRequests } from './httpMapping'
import type { HttpResponse } from './httpMapping'
import type { ParseCampaignSpreadsheet } from '../ports/spreadsheetParser'

const SPREADSHEET_FIELD = 'spreadsheet'
const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024
const MAX_CONCURRENT_CREATES = 5

let activeCreates = 0

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
 * Limita a `MAX_CONCURRENT_CREATES` as criações de campanha em andamento. Deve rodar antes do
 * multer, que é quem copia o arquivo para a memória. Com o limite atingido responde 429 `{}`
 * sem chamar `next()` e sem ocupar vaga; não há fila de espera. A checagem e o incremento são
 * síncronos, então duas requisições não passam pela mesma última vaga. A vaga é liberada uma
 * única vez, em `finish` ou `close` (o que vier primeiro), inclusive em erro ou desconexão.
 * @param _req Requisição (não usada).
 * @param res Resposta do Express.
 * @param next Segue para o multer quando há vaga.
 */
const limitConcurrentCreates: RequestHandler = (_req, res, next) => {
  if (activeCreates >= MAX_CONCURRENT_CREATES) {
    sendJson(res, tooManyRequests())
    return
  }
  activeCreates++
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    activeCreates--
  }
  res.once('finish', release)
  res.once('close', release)
  next()
}

/**
 * Cria o middleware que lê o `multipart/form-data` de `POST /campaigns`: um arquivo no campo
 * `spreadsheet` (até 5 MiB, em memória) mais os campos de texto em `req.body`. Qualquer erro
 * do multer (arquivo grande, campo inesperado, corpo malformado) responde 400 `{}`.
 * @returns Middleware para usar somente nessa rota.
 */
function createSpreadsheetUpload(): RequestHandler {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SPREADSHEET_BYTES } })
  const single = upload.single(SPREADSHEET_FIELD)
  return (req, res, next) => {
    single(req, res, (err?: unknown) => {
      if (err) {
        sendJson(res, badRequest())
        return
      }
      next()
    })
  }
}

/**
 * Monta o app Express com as cinco rotas. Não chama `listen`; quem sobe o servidor é o `main`.
 * `POST /campaigns` recebe `multipart/form-data` (`template` + `spreadsheet`); o `parseSpreadsheet`
 * converte isso no corpo que o caso de uso já aceita. As demais rotas seguem em JSON.
 * @param useCases Casos de uso (ou objetos com `execute` de mesma assinatura).
 * @param parseSpreadsheet Leitor da planilha, ligado pelo `main`.
 * @returns App Express pronto para ser servido.
 */
export function createApp(useCases: ControllerUseCases, parseSpreadsheet: ParseCampaignSpreadsheet): express.Express {
  const app = express()
  app.use(express.json())

  app.post(
    '/campaigns',
    limitConcurrentCreates,
    createSpreadsheetUpload(),
    toRoute(async (req) => {
      const parsed = await parseSpreadsheet(req.file?.buffer, req.body?.template, req.file?.originalname)
      if (parsed.kind === 'invalid') return badRequest()
      return handleCreateCampaign(useCases.createCampaign, parsed.body)
    }),
  )
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
