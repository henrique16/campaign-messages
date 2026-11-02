import { PAGE_SIZE, parsePage } from '../domain/rules'
import type { CampaignFailureReader, FailureItem } from '../ports/campaignRepository'

export type ListCampaignFailuresResult =
  | { kind: 'invalid' }
  | { kind: 'not_found' }
  | { kind: 'ok'; items: FailureItem[]; page: number; pageSize: number; total: number }

export class ListCampaignFailures {
  /**
   * @param reader Porta que lista as falhas persistidas.
   */
  constructor(private readonly reader: CampaignFailureReader) {}

  /**
   * Lista uma página de falhas; o tamanho da página é sempre `PAGE_SIZE`.
   * @param campaignId Campanha consultada.
   * @param rawPage Valor bruto de `page`; `undefined` vale 1.
   */
  async execute(campaignId: number, rawPage: unknown): Promise<ListCampaignFailuresResult> {
    const parsed = parsePage(rawPage)
    if (parsed.kind === 'invalid') return { kind: 'invalid' }
    const result = await this.reader.listFailures(campaignId, parsed.page, PAGE_SIZE)
    if (result === null) return { kind: 'not_found' }
    return { kind: 'ok', items: result.items, page: parsed.page, pageSize: PAGE_SIZE, total: result.total }
  }
}
