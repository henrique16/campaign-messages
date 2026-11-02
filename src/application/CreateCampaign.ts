import { ingestContacts, parseCreateCampaign } from '../domain/createCampaignInput'
import type { RejectedContact } from '../domain/createCampaignInput'
import type { CampaignCreator } from '../ports/campaignRepository'

export type CreateCampaignResult =
  | { kind: 'invalid' }
  | { kind: 'created'; id: number; accepted: number; rejected: RejectedContact[] }

export class CreateCampaign {
  /**
   * @param creator Porta que persiste a campanha e as mensagens aceitas.
   */
  constructor(private readonly creator: CampaignCreator) {}

  /**
   * Valida o corpo, renderiza os contatos e cria a campanha, mesmo com 0 aceitos.
   * @param raw Corpo bruto do create.
   */
  async execute(raw: unknown): Promise<CreateCampaignResult> {
    const parsed = parseCreateCampaign(raw)
    if (parsed.kind === 'invalid') return { kind: 'invalid' }
    const { accepted, rejected } = ingestContacts(parsed.template, parsed.contacts)
    const id = await this.creator.createCampaignWithMessages(parsed.template, accepted)
    return { kind: 'created', id, accepted: accepted.length, rejected }
  }
}
