import type { CampaignStatus } from '../domain/campaignStatus'
import type { AcceptedContact } from '../domain/createCampaignInput'
import type { MessageStatus } from '../domain/messageStatus'
import type { WebhookDecision } from '../domain/messageTransitions'
import type { WebhookEvent } from '../domain/webhookEvent'

export type CampaignTotals = Record<MessageStatus, number>

export type CampaignSummary = { id: number; status: CampaignStatus; totals: CampaignTotals }

export type FailureItem = { phone: string; reason: string }

export type FailurePage = { items: FailureItem[]; total: number }

export type ClaimedMessage = {
  messageId: number
  campaignId: number
  phone: string
  body: string
  attemptCount: number
}

export type ClaimDueInput = { now: Date; staleBefore: Date; limit: number }

export type StartResult =
  | { kind: 'started' }
  | { kind: 'not_found' }
  | { kind: 'unchanged'; status: 'running' | 'finished' }

export type WebhookApplyResult = 'applied' | 'duplicate' | 'unknown_message'

/** Recebe o estado atual da mensagem e devolve a decisão; é `decideWebhook` já com o evento fixado. */
export type WebhookDecider = (current: MessageStatus) => WebhookDecision

export interface CampaignCreator {
  /** Cria a campanha e as mensagens aceitas numa única transação; devolve o id da campanha. */
  createCampaignWithMessages(template: string, accepted: readonly AcceptedContact[]): Promise<number>
}

export interface CampaignSummaryReader {
  /** Devolve `null` quando a campanha não existe. */
  getSummary(campaignId: number): Promise<CampaignSummary | null>
}

export interface CampaignFailureReader {
  /** Falhas por id de mensagem crescente; `null` quando a campanha não existe. */
  listFailures(campaignId: number, page: number, pageSize: number): Promise<FailurePage | null>
}

export interface CampaignStarter {
  /** Passa `draft` para `running`; informa se iniciou, se não existe ou o status que já estava. */
  markRunningIfDraft(campaignId: number): Promise<StartResult>
}

export interface CampaignFinisher {
  /** Passa `running` para `finished`, de forma condicional. */
  markFinished(campaignId: number): Promise<void>
}

export interface DueMessageClaim {
  /** Reivindica de forma atômica até `limit` mensagens elegíveis. */
  claimDue(input: ClaimDueInput): Promise<ClaimedMessage[]>
}

export interface MessageOutcomeStore {
  /** Grava `sent` e o id do provedor, e libera o claim. */
  recordSent(messageId: number, providerMessageId: string): Promise<void>
  /** Mantém `queued`, grava tentativa e próximo horário, e libera o claim. */
  recordRetry(messageId: number, attemptCount: number, nextAttemptAt: Date): Promise<void>
  /** Grava `failed` com o motivo e libera o claim. */
  recordFailed(messageId: number, reason: string): Promise<void>
}

export interface ProviderWebhookStore {
  /** Aplica o evento de forma idempotente por `eventId`; `decide` é chamada com o estado atual. */
  applyWebhookEvent(event: WebhookEvent, decide: WebhookDecider): Promise<WebhookApplyResult>
}

export type CampaignRepository = CampaignCreator &
  CampaignSummaryReader &
  CampaignFailureReader &
  CampaignStarter &
  CampaignFinisher &
  DueMessageClaim &
  MessageOutcomeStore &
  ProviderWebhookStore
