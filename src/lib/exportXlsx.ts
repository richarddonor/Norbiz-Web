import * as XLSX from 'xlsx'
import type { ColumnDef } from '@/components/ColumnsMenu'
import { groupTree, sumColumns, toNumber, type GroupNode, type RowGrouping } from '@/hooks/useRowGrouping'

export type ExportColumn = Pick<ColumnDef, 'key' | 'label' | 'total'>

type Row = Record<string, unknown>

/** Writes `rows` (the page's `listRow` outputs, already in the list's sort order) to a spreadsheet
 * laid out like the list: the visible `columns`; with `grouping` on, a header row per group
 * (`Label: value (count)` plus its subtotals) in the on-screen group order, its rows nested under
 * it as an Excel outline level so it collapses. `total` columns are written as numbers, and a
 * Grand total row closes the sheet when any is exported. */
export function exportToXlsx(filename: string, columns: readonly ExportColumn[], rows: Row[], grouping?: RowGrouping) {
  const grouped = grouping?.active ?? false
  // Group and grand-total labels go in the first column that isn't a total.
  const labelIndex = columns.findIndex(c => !c.total)

  const aoa: XLSX.CellObject[][] = [columns.map(c => text(c.label))]
  const rowInfo: XLSX.RowInfo[] = [{}]

  function push(cells: XLSX.CellObject[], level: number) {
    aoa.push(cells)
    rowInfo.push(level > 0 ? { level } : {})
  }

  function summaryRow(label: string, sums: Record<string, number>, level: number) {
    push(columns.map((c, i) =>
      c.total && sums[c.key] !== undefined ? number(c.total, sums[c.key]) : text(i === labelIndex ? label : ''),
    ), level)
  }

  function itemRow(row: Row, level: number) {
    push(columns.map(c => {
      const n = c.total ? toNumber(row[c.key]) : null
      return n !== null ? number(c.total, n) : text(row[c.key] == null ? '' : String(row[c.key]))
    }), level)
  }

  function writeGroups(nodes: GroupNode<Row>[], depth: number) {
    for (const n of nodes) {
      const label = grouping!.columns.find(c => c.key === n.columnKey)?.label ?? n.columnKey
      const value = n.value === '' ? '(blank)' : n.value
      summaryRow(`${'    '.repeat(depth)}${label}: ${value} (${n.count.toLocaleString()})`, n.sums, depth)
      if (n.children) writeGroups(n.children, depth + 1)
      else for (const row of n.items) itemRow(row, depth + 1)
    }
  }

  if (grouped) writeGroups(groupTree(rows, rows, grouping!.columns, grouping!.groupBy), 0)
  else for (const row of rows) itemRow(row, 0)

  if (columns.some(c => c.total)) summaryRow('Grand total', sumColumns(rows, columns), 0)

  const worksheet = XLSX.utils.aoa_to_sheet(aoa)
  if (grouped) {
    worksheet['!rows'] = rowInfo
    // Group headers sit above their rows, so Excel's collapse buttons go there too.
    worksheet['!outline'] = { above: true }
  }
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

function text(value: string): XLSX.CellObject {
  return { t: 's', v: value }
}

/** Currency as `#,##0.00`; quantities as on screen: up to 4 decimals, none for whole numbers. */
function number(kind: ColumnDef['total'], value: number): XLSX.CellObject {
  if (kind === 'currency') return { t: 'n', v: Math.round(value * 100) / 100, z: '#,##0.00' }
  const v = Math.round(value * 10000) / 10000
  return { t: 'n', v, z: Number.isInteger(v) ? '#,##0' : '#,##0.####' }
}
