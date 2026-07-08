import * as XLSX from 'xlsx'

export interface ExportColumn {
  key: string
  label: string
}

export function exportToXlsx(filename: string, columns: readonly ExportColumn[], rows: Record<string, unknown>[]) {
  const data = rows.map(row => {
    const record: Record<string, unknown> = {}
    for (const col of columns) record[col.label] = row[col.key] ?? ''
    return record
  })

  const worksheet = XLSX.utils.json_to_sheet(data, { header: columns.map(c => c.label) })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}
