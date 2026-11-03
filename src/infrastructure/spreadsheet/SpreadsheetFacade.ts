import type { SpreadsheetParse } from '../../ports/spreadsheetParser'
import type { CampaignSpreadsheetReader } from './CampaignSpreadsheetReader'
import { SynonymHeaderSpreadsheet } from './SynonymHeaderSpreadsheet'
import { SPREADSHEET_TYPE, type SpreadsheetType } from './spreadsheetType'

/** Entrada única de leitura de planilha de campanha: escolhe o leitor pela extensão do nome do arquivo. */
export class SpreadsheetFacade {
  private readonly readers: Record<SpreadsheetType, CampaignSpreadsheetReader> = {
    [SPREADSHEET_TYPE.XLSX]: new SynonymHeaderSpreadsheet(),
  }

  /**
   * Lê a planilha com o leitor registrado para a extensão do nome do arquivo. A fachada não lê xlsx; só delega.
   * A extensão é o trecho depois do último `.`, em maiúsculas (`pasta.backup.xlsx` vira `XLSX`).
   * @param file Conteúdo do arquivo enviado, ou `undefined` quando não veio arquivo.
   * @param template Campo `template` do formulário.
   * @param filename Nome original do arquivo enviado, ou `undefined` quando não veio nome.
   * @returns O resultado do leitor, ou `invalid` quando falta arquivo, nome ou ponto, ou a extensão não é um `SPREADSHEET_TYPE`.
   */
  async parse(
    file: Buffer | undefined,
    template: unknown,
    filename: string | undefined,
  ): Promise<SpreadsheetParse> {
    if (file === undefined || filename === undefined) return { kind: 'invalid' }
    const dot = filename.lastIndexOf('.')
    if (dot === -1) return { kind: 'invalid' }
    const extension = filename.slice(dot + 1).toUpperCase()
    const reader: CampaignSpreadsheetReader | undefined = this.readers[extension as SpreadsheetType]
    if (reader === undefined) return { kind: 'invalid' }
    return reader.parse(file, template)
  }
}
