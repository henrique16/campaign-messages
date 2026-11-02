import * as Sentry from '@sentry/node'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express'

/**
 * Inicia o OpenTelemetry (traces via OTLP HTTP) e, somente se `SENTRY_DSN`
 * estiver preenchido, o Sentry.
 * Deve ser chamada uma vez no início de `main.ts`, antes de carregar o express,
 * para que as instrumentações enxerguem o módulo. Não roda no import.
 * Nunca lança: se o collector estiver fora do ar, o exporter só registra o
 * erro e a aplicação segue de pé.
 */
export function startTelemetry(): void {
  startOpenTelemetry()
  startSentry()
}

/**
 * Sobe o NodeSDK com exporter OTLP HTTP e instrumentação de http/express.
 * O endpoint vem de `OTEL_EXPORTER_OTLP_ENDPOINT` (o exporter acrescenta `/v1/traces`).
 * Qualquer falha de inicialização é logada e engolida.
 */
function startOpenTelemetry(): void {
  try {
    const sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME || 'campaign-messages',
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
    })
    sdk.start()
  } catch (err) {
    console.error('[telemetry] OpenTelemetry não iniciou:', err)
  }
}

/**
 * Inicializa o Sentry apenas quando `SENTRY_DSN` não está vazio.
 * `skipOpenTelemetrySetup` evita que o Sentry registre um segundo tracer
 * provider: os traces ficam por conta do OpenTelemetry acima e o Sentry
 * cuida só de erros.
 */
function startSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim()
  if (!dsn) return
  try {
    Sentry.init({ dsn, skipOpenTelemetrySetup: true })
  } catch (err) {
    console.error('[telemetry] Sentry não iniciou:', err)
  }
}
