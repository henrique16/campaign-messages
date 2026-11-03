import ExcelJS from 'exceljs'
import { extractPlaceholders } from '../../domain/template'
import type { SpreadsheetParse } from '../../ports/spreadsheetParser'
import type { CampaignSpreadsheetReader } from './CampaignSpreadsheetReader'

/** Cabeçalhos aceitos para a coluna de telefone (comparados já normalizados). */
export const PHONE_HEADER_SYNONYMS: readonly string[] = ['phone', 'telefone', 'celular', 'whatsapp', 'fone']

/**
 * Apelidos extras de cabeçalho por chave exata do template, ex.: `{ nome: ['cliente'] }`.
 * Um layout novo de cliente entra aqui como nova entrada.
 */
export const VARIABLE_HEADER_ALIASES: Record<string, readonly string[]> = {}

const INVALID: SpreadsheetParse = { kind: 'invalid' }

/** Coluna da planilha ligada a uma chave do template. */
type VariableColumn = { key: string; column: number }

/** Posição do cabeçalho e as colunas que interessam. */
type HeaderLayout = { rowNumber: number; phoneColumn: number; variableColumns: VariableColumn[] }

/**
 * Normaliza um texto só para comparação: remove espaços nas pontas, passa para minúsculas
 * e tira acentos (NFD sem marcas combinantes). Espaços internos são mantidos.
 * @param text Texto bruto do cabeçalho ou da chave.
 */
function normalizeHeader(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/**
 * Lê os textos exibidos das células com conteúdo de uma linha.
 * @param row Linha da planilha.
 * @returns Pares coluna (base 1) e texto exibido, sem as células vazias.
 */
function readRowTexts(row: ExcelJS.Row): { column: number; text: string }[] {
  const cells: { column: number; text: string }[] = []
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    cells.push({ column, text: cell.text })
  })
  return cells
}

/**
 * Diz se o cabeçalho normalizado corresponde à chave do template: igual à chave
 * normalizada ou igual a um apelido normalizado cadastrado para essa mesma chave.
 * @param header Cabeçalho já normalizado.
 * @param key Chave exata do template.
 */
function headerMatchesKey(header: string, key: string): boolean {
  if (header === normalizeHeader(key)) return true
  return (VARIABLE_HEADER_ALIASES[key] ?? []).some((alias) => normalizeHeader(alias) === header)
}

/**
 * Procura a primeira linha com um cabeçalho de telefone e mapeia as colunas das chaves do template.
 * Uma coluna de telefone nunca vira variável.
 * @param worksheet Primeira planilha do arquivo.
 * @param keys Chaves distintas do template, como escritas nele.
 * @returns O layout, ou `null` quando não há telefone, há telefone repetido ou duas colunas para a mesma chave.
 */
function findHeaderLayout(worksheet: ExcelJS.Worksheet, keys: string[]): HeaderLayout | null {
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const cells = readRowTexts(worksheet.getRow(rowNumber)).map(({ column, text }) => ({
      column,
      header: normalizeHeader(text),
    }))
    const phoneCells = cells.filter(({ header }) => PHONE_HEADER_SYNONYMS.includes(header))
    if (phoneCells.length === 0) continue
    if (phoneCells.length > 1) return null

    const phoneColumn = phoneCells[0].column
    const variableColumns: VariableColumn[] = []
    for (const { column, header } of cells) {
      if (column === phoneColumn) continue
      for (const key of keys) {
        if (headerMatchesKey(header, key)) variableColumns.push({ key, column })
      }
    }
    const distinctKeys = new Set(variableColumns.map(({ key }) => key))
    if (distinctKeys.size !== variableColumns.length) return null
    return { rowNumber, phoneColumn, variableColumns }
  }
  return null
}

/**
 * Monta os contatos das linhas abaixo do cabeçalho. Linha com telefone e todas as variáveis
 * mapeadas vazios é ignorada; célula vazia de um contato aproveitado vira `''`.
 * @param worksheet Primeira planilha do arquivo.
 * @param layout Posição do cabeçalho e colunas mapeadas.
 */
function readContacts(worksheet: ExcelJS.Worksheet, layout: HeaderLayout): { phone: string; variables: Record<string, string> }[] {
  const contacts: { phone: string; variables: Record<string, string> }[] = []
  for (let rowNumber = layout.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const phone = row.getCell(layout.phoneColumn).text
    // Sem protótipo: uma chave de template como `__proto__` vira propriedade própria, não altera o protótipo.
    const variables: Record<string, string> = Object.create(null)
    for (const { key, column } of layout.variableColumns) variables[key] = row.getCell(column).text

    const isEmptyRow = phone.trim() === '' && Object.values(variables).every((value) => value.trim() === '')
    if (!isEmptyRow) contacts.push({ phone, variables })
  }
  return contacts
}

/** Leitor da extensão `XLSX`: telefone só por sinônimo de cabeçalho e variáveis pelas chaves do template. */
export class SynonymHeaderSpreadsheet implements CampaignSpreadsheetReader {
  /**
   * Lê a primeira planilha de um `.xlsx` e monta o corpo de `POST /campaigns`.
   * O cabeçalho é a primeira linha com um sinônimo de telefone; linhas acima dele são ignoradas.
   * Cada chave de `{{chave}}` do template recebe o texto da coluna de mesmo nome (ver `VARIABLE_HEADER_ALIASES`);
   * chaves sem coluna ficam fora de `variables`. Usa o texto exibido da célula (`cell.text`).
   * @param file Conteúdo do arquivo enviado, ou `undefined` quando não veio arquivo.
   * @param template Campo `template` do formulário; precisa ser string.
   * @returns `ready` com o corpo, ou `invalid` para arquivo ausente/ilegível, sem planilha,
   * `template` que não é string ou cabeçalho fora das regras (sem telefone, telefone repetido, chave repetida).
   */
  async parse(file: Buffer | undefined, template: unknown): Promise<SpreadsheetParse> {
    if (file === undefined || typeof template !== 'string') return INVALID

    const workbook = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.load(file as unknown as ArrayBuffer)
    } catch {
      return INVALID
    }
    const worksheet = workbook.worksheets[0]
    if (worksheet === undefined) return INVALID

    const layout = findHeaderLayout(worksheet, extractPlaceholders(template))
    if (layout === null) return INVALID
    return { kind: 'ready', body: { template, contacts: readContacts(worksheet, layout) } }
  }
}
