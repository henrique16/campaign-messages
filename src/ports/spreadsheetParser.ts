/** Corpo que `CreateCampaign.execute` já aceita, montado a partir da planilha. */
export type CampaignBody = {
  template: string
  contacts: { phone: string; variables: Record<string, string> }[]
}

/** Resultado da leitura da planilha: corpo pronto ou entrada inválida. */
export type SpreadsheetParse = { kind: 'invalid' } | { kind: 'ready'; body: CampaignBody }

/**
 * Porta do leitor de planilha: recebe o arquivo (se houver), o campo `template` do formulário
 * e o nome original do arquivo enviado, de onde sai a extensão que escolhe o leitor.
 */
export type ParseCampaignSpreadsheet = (
  file: Buffer | undefined,
  template: unknown,
  filename: string | undefined,
) => Promise<SpreadsheetParse>
