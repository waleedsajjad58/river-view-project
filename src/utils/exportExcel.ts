import ExcelJS from 'exceljs'

type CellValue = string | number | null | undefined

type ExportExcelOptions = {
  fileName: string
  sheetName: string
  title: string
  subtitle?: string
  meta?: string[]
  headers: string[]
  rows: CellValue[][]
  numericColumns?: number[]
}

const DATA_FONT_SIZE = 11
const TITLE_FONT_SIZE = 13

function safeSheetName(sheetName: string) {
  return sheetName.replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31) || 'Sheet1'
}

function inferWidths(headers: string[], rows: CellValue[][]) {
  return headers.map((header, index) => {
    const longest = rows.reduce((max, row) => {
      const cell = row[index]
      const value = cell === null || cell === undefined ? '' : String(cell)
      return Math.max(max, value.length)
    }, header.length)

    return { width: Math.min(Math.max(longest + 4, 14), 28) }
  })
}

export async function exportExcelFile({ fileName, sheetName, title, subtitle, meta = [], headers, rows, numericColumns = [] }: ExportExcelOptions) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'River View ERP'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet(safeSheetName(sheetName), {
    views: [{ state: 'frozen', ySplit: meta.length + (subtitle ? 3 : 2) }],
    pageSetup: {
      margins: {
        left: 0.4,
        right: 0.4,
        top: 0.55,
        bottom: 0.55,
        header: 0.2,
        footer: 0.2,
      },
      orientation: headers.length > 6 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  })

  const totalColumns = Math.max(headers.length, 1)
  const lastColumn = Math.max(totalColumns, 1)

  worksheet.mergeCells(1, 1, 1, lastColumn)
  const titleCell = worksheet.getCell(1, 1)
  titleCell.value = title
  titleCell.font = { bold: true, size: TITLE_FONT_SIZE, name: 'Calibri' }
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' }
  worksheet.getRow(1).height = 22

  let currentRow = 2
  if (subtitle) {
    worksheet.mergeCells(currentRow, 1, currentRow, lastColumn)
    const subtitleCell = worksheet.getCell(currentRow, 1)
    subtitleCell.value = subtitle
    subtitleCell.font = { bold: true, size: TITLE_FONT_SIZE, name: 'Calibri' }
    subtitleCell.alignment = { horizontal: 'left', vertical: 'middle' }
    worksheet.getRow(currentRow).height = 20
    currentRow += 1
  }

  for (const metaLine of meta) {
    worksheet.mergeCells(currentRow, 1, currentRow, lastColumn)
    const metaCell = worksheet.getCell(currentRow, 1)
    metaCell.value = metaLine
    metaCell.font = { size: DATA_FONT_SIZE, name: 'Calibri' }
    metaCell.alignment = { horizontal: 'left', vertical: 'middle' }
    worksheet.getRow(currentRow).height = 18
    currentRow += 1
  }

  currentRow += 1

  const headerRow = worksheet.getRow(currentRow)
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = header
    cell.font = { bold: true, size: TITLE_FONT_SIZE, name: 'Calibri' }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    }
  })
  headerRow.height = 24

  rows.forEach((rowValues, rowIndex) => {
    const row = worksheet.getRow(currentRow + 1 + rowIndex)
    headers.forEach((_, columnIndex) => {
      const cell = row.getCell(columnIndex + 1)
      const value = rowValues[columnIndex]
      cell.value = value ?? ''
      cell.font = { size: DATA_FONT_SIZE, name: 'Calibri' }
      cell.alignment = {
        horizontal: numericColumns.includes(columnIndex + 1) ? 'center' : 'left',
        vertical: 'middle',
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
      if (typeof value === 'number') {
        cell.numFmt = Number.isInteger(value) ? '#,##0' : '#,##0.00'
      }
    })
    row.height = 21
  })

  worksheet.columns = inferWidths(headers, rows)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}