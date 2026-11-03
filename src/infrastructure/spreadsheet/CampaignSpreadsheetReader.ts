import type { SpreadsheetParse } from '../../ports/spreadsheetParser'

/** Leitor de um tipo de planilha de campanha: converte o arquivo no corpo de `POST /campaigns`. */
export interface CampaignSpreadsheetReader {
  /**
   * Lê o arquivo enviado e monta o corpo da campanha.
   * @param file Conteúdo do arquivo, ou `undefined` quando não veio arquivo.
   * @param template Campo `template` do formulário.
   * @returns `ready` com o corpo, ou `invalid` quando a entrada não segue as regras do tipo.
   */
  parse(file: Buffer | undefined, template: unknown): Promise<SpreadsheetParse>
}
