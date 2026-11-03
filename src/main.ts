import { createPool } from 'mysql2/promise'
import * as Sentry from '@sentry/node'
import { ApplyProviderWebhook } from './application/ApplyProviderWebhook'
import { CreateCampaign } from './application/CreateCampaign'
import { FinishCampaignIfDone } from './application/FinishCampaignIfDone'
import { GetCampaign } from './application/GetCampaign'
import { ListCampaignFailures } from './application/ListCampaignFailures'
import { ProcessClaimedMessage } from './application/ProcessClaimedMessage'
import { SendWorker } from './application/SendWorker'
import { StartCampaign } from './application/StartCampaign'
import { classifyProviderError } from './domain/providerFailure'
import { decideAfterTransient } from './domain/retryPolicy'
import { FakeProviderAdapter } from './infrastructure/provider/FakeProviderAdapter'
import { MySqlCampaignRepository } from './infrastructure/mysql/MySqlCampaignRepository'
import { SystemClock } from './infrastructure/system/SystemClock'
import { startTelemetry } from './telemetry'
import { createApp } from './controller/expressApp'
import { SpreadsheetFacade } from './infrastructure/spreadsheet/SpreadsheetFacade'

// As rotas de campanha são montadas aqui, em bootstrap, sobre o mesmo app que serve /health.

/**
 * Lê `WORKER_POLL_INTERVAL_MS`; só um número positivo vale.
 * @returns O intervalo, ou `undefined` para o `SendWorker` usar o padrão.
 */
function readPollIntervalMs(): number | undefined {
  const value = Number(process.env.WORKER_POLL_INTERVAL_MS)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Ponto de entrada: inicia a telemetria, carrega o express (via `expressApp`), liga o repositório
 * MySQL, os casos de uso e o `SendWorker`, e escuta em `PORT` (padrão 3000).
 * O `expressApp` e o leitor de planilha são importados dinamicamente para o express ser carregado depois das instrumentações.
 * Falha de telemetria ou de MySQL não é capturada: o processo cai.
 */
async function bootstrap(): Promise<void> {
  startTelemetry()
  const spreadsheet = new SpreadsheetFacade()

  const pool = createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 10,
    timezone: 'Z',
  })
  const repository = new MySqlCampaignRepository(pool)
  const provider = new FakeProviderAdapter()
  const clock = new SystemClock()

  const finishIfDone = new FinishCampaignIfDone(repository, repository)
  const processor = new ProcessClaimedMessage(
    provider,
    classifyProviderError,
    decideAfterTransient,
    clock,
    repository,
    finishIfDone,
  )
  const worker = new SendWorker(repository, clock, processor, readPollIntervalMs())

  const app = createApp({
    createCampaign: new CreateCampaign(repository),
    startCampaign: new StartCampaign(repository, finishIfDone),
    getCampaign: new GetCampaign(repository),
    listCampaignFailures: new ListCampaignFailures(repository),
    applyProviderWebhook: new ApplyProviderWebhook(repository),
  }, (file, template, filename) => spreadsheet.parse(file, template, filename))
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' })
  })
  Sentry.setupExpressErrorHandler(app)

  const port = Number(process.env.PORT) || 3000
  app.listen(port, () => {
    console.log(`[main] listening on ${port}`)
    worker.start()
  })
}

void bootstrap()
