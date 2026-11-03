export const SPREADSHEET_TYPE = {
  XLSX: 'XLSX',
} as const

export type SpreadsheetType = (typeof SPREADSHEET_TYPE)[keyof typeof SPREADSHEET_TYPE]
