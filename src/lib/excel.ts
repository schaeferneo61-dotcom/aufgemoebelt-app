import * as XLSX from 'xlsx'
import type { Product, Project, ProjectItem } from '../types'

// ── IMPORT ──────────────────────────────────────────────────

function parseRows(data: Uint8Array): Omit<Product, 'id' | 'created_at' | 'updated_at'>[] {
  const workbook = XLSX.read(data, { type: 'array', cellStyles: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]

  // Zusammengeführte Zellen expandieren:
  // Excel speichert nur die erste Zelle einer Zusammenführung mit einem Wert.
  // Wir kopieren diesen Wert in alle anderen Zellen der Zusammenführung.
  const merges: XLSX.Range[] = (sheet['!merges'] as XLSX.Range[]) || []
  for (const merge of merges) {
    const topLeftRef = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })
    const topLeftCell = sheet[topLeftRef]
    if (!topLeftCell) continue
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r === merge.s.r && c === merge.s.c) continue
        const ref = XLSX.utils.encode_cell({ r, c })
        sheet[ref] = { ...topLeftCell }
      }
    }
  }

  // Rohe Zeilen lesen (mit Spaltenindex, unabhängig von Spaltennamen)
  const rawRows: (string | number | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
  })

  if (rawRows.length < 2) return []

  const parseNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    // € Symbol, Leerzeichen entfernen, Komma → Punkt
    const s = String(v).replace(/[€\s]/g, '').replace(',', '.')
    const n = parseFloat(s)
    return isNaN(n) ? null : n
  }

  const toStr = (v: unknown): string | null => {
    if (v === null || v === undefined || v === '') return null
    return String(v).trim()
  }

  // Kopfzeile finden (erste Zeile mit mehr als 2 gefüllten Zellen)
  let headerRowIdx = 0
  for (let i = 0; i < Math.min(5, rawRows.length); i++) {
    const filled = rawRows[i].filter((c) => c !== null && c !== '').length
    if (filled >= 3) { headerRowIdx = i; break }
  }

  const headers = rawRows[headerRowIdx].map((h) => toStr(h)?.toLowerCase() ?? '')

  // Spaltenindizes anhand von Schlüsselwörtern finden
  const findCol = (...keys: string[]) => {
    for (const key of keys) {
      const idx = headers.findIndex((h) => h.includes(key))
      if (idx >= 0) return idx
    }
    return -1
  }

  const colProdukt   = findCol('produkt', 'artikel', 'bezeichnung', 'name', 'material')
  const colKategorie = findCol('kategorie', 'kategori', 'typ', 'gruppe', 'bereich')
  const colStaerke   = findCol('stärke', 'staerke', 'dicke', 'stark')
  const colMasse     = findCol('maße', 'masse', 'maß', 'breite', 'abmessung')
  const colM2        = findCol('m2', 'm²', 'lfm', 'fläche')
  const colHaendler  = findCol('händler', 'haendler', 'lieferant', 'hersteller')
  const colEK        = findCol('ek-preis', 'ek preis', 'einkauf', 'ek netto', 'ek_preis')
  const colVK        = findCol('vk-preis', 'vk preis', 'verkauf', 'vk netto', 'vk_preis')
  const colPalette   = findCol('stk/palette', 'palette')

  // Erster Spaltenindex (für Kategorien-Erkennung)
  const firstCol = colProdukt >= 0 ? colProdukt : 0

  let currentKategorie: string | null = null
  const result: Omit<Product, 'id' | 'created_at' | 'updated_at'>[] = []

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || row.every((c) => c === null || c === '')) continue

    // Ausgefüllte Zellen zählen
    const filledCells = row.filter((c) => c !== null && c !== '').length
    const firstCellVal = toStr(row[firstCol])

    // Explizite Kategorie-Spalte
    if (colKategorie >= 0 && toStr(row[colKategorie])) {
      currentKategorie = toStr(row[colKategorie])
    }

    // Kategorie-Zeile erkennen:
    // - Nur 1-2 Zellen gefüllt UND keine Preise vorhanden
    // - ODER der Wert entspricht einer bekannten Kategorie
    const hatEK = colEK >= 0 && parseNum(row[colEK]) !== null
    const hatVK = colVK >= 0 && parseNum(row[colVK]) !== null
    const hatHaendler = colHaendler >= 0 && toStr(row[colHaendler]) !== null

    const istKategorieZeile =
      firstCellVal &&
      filledCells <= 2 &&
      !hatEK && !hatVK

    if (istKategorieZeile && colKategorie < 0) {
      currentKategorie = firstCellVal
      continue
    }

    // Produkt-Zeile
    if (!firstCellVal) continue

    // Wenn explizite Kategorie-Spalte existiert aber diese Zeile nur 1 Zelle hat → Kategorie
    if (colKategorie < 0 && filledCells <= 1) {
      currentKategorie = firstCellVal
      continue
    }

    result.push({
      produkt: firstCellVal,
      // Bei zusammengeführten Zellen ist der Wert nur in der ersten Zeile – Rest ist null
      // Deshalb Fallback auf currentKategorie wenn null
      kategorie: colKategorie >= 0 ? (toStr(row[colKategorie]) ?? currentKategorie) : currentKategorie,
      staerke_mm: colStaerke >= 0 ? toStr(row[colStaerke]) : null,
      masse_mm: colMasse >= 0 ? toStr(row[colMasse]) : null,
      m2_lfm: colM2 >= 0 ? toStr(row[colM2]) : null,
      haendler: hatHaendler ? toStr(row[colHaendler]) : null,
      ek_preis: colEK >= 0 ? parseNum(row[colEK]) : null,
      vk_preis: colVK >= 0 ? parseNum(row[colVK]) : null,
      stk_palette: colPalette >= 0 ? toStr(row[colPalette]) : null,
      bestand: 0,
    })
  }

  return result.filter((p) => p.produkt.length > 0)
}

export async function parseProductExcelFromUrl(url: string): Promise<Omit<Product, 'id' | 'created_at' | 'updated_at'>[]> {
  const downloadUrl = url.includes('download=1') ? url : url + (url.includes('?') ? '&' : '?') + 'download=1'
  const response = await fetch(downloadUrl)
  if (!response.ok) throw new Error('Datei konnte nicht geladen werden (Status ' + response.status + ')')
  const buffer = await response.arrayBuffer()
  const data = new Uint8Array(buffer)
  return parseRows(data)
}

export function parseProductExcel(file: File): Promise<Omit<Product, 'id' | 'created_at' | 'updated_at'>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const products = parseRows(data)
        resolve(products)
      } catch (err) {
        reject(new Error('Excel-Datei konnte nicht gelesen werden: ' + String(err)))
      }
    }
    reader.onerror = () => reject(new Error('Datei konnte nicht geöffnet werden'))
    reader.readAsArrayBuffer(file)
  })
}

// ── Direkter Browser-Download ────────────────────────────────

function downloadWorkbook(workbook: XLSX.WorkBook, filename: string): void {
  const buf: number[] = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([new Uint8Array(buf)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export interface ExportData {
  project: Project
  items: (ProjectItem & { product?: Product | null })[]
  creatorName?: string
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\wäöüÄÖÜß\s-]/g, '').replace(/\s+/g, '_').substring(0, 50)
}

function S(ws: XLSX.WorkSheet, ref: string, style: object) {
  if (!ws[ref]) ws[ref] = { v: '', t: 's' }
  ws[ref].s = style
}

export async function exportProjectToExcel(data: ExportData): Promise<void> {
  const wb = XLSX.utils.book_new()
  const rows: (string | number)[][] = []

  // Titel
  rows.push(['aufgemoebelt', '', '', '', '', '', '', '', ''])
  rows.push([data.project.name, '', '', '', '', '', '', '', ''])
  rows.push([data.project.beschreibung ?? '', '', '', '', '', '', '', '', ''])
  rows.push([
    `Status: ${data.project.status.charAt(0).toUpperCase() + data.project.status.slice(1)}`,
    '', '',
    data.project.enddatum ? `Enddatum: ${new Date(data.project.enddatum).toLocaleDateString('de-AT')}` : '',
    '', '',
    `Exportiert: ${new Date().toLocaleDateString('de-AT')}`,
    '', ''
  ])
  rows.push([]) // Leerzeile

  // Header
  const header = ['Ware', 'Kategorie', 'Stärke', 'Maße', 'Händler', 'Menge', 'EK netto/Stk', 'VK netto/Stk', 'Gesamt VK']
  rows.push(header)
  const headerRowIdx = rows.length - 1

  // Daten
  for (const item of data.items) {
    rows.push([
      item.product?.produkt ?? item.product_name ?? '(gelöscht)',
      item.product?.kategorie ?? item.product_kategorie ?? '',
      item.product?.staerke_mm ?? '',
      item.product?.masse_mm ?? '',
      item.product?.haendler ?? '',
      item.menge,
      item.product?.ek_preis ?? '',
      item.product?.vk_preis ?? '',
      item.menge * (item.product?.vk_preis ?? 0),
    ])
  }

  rows.push([])
  const totalEK = data.items.reduce((s, i) => s + i.menge * (i.product?.ek_preis ?? 0), 0)
  const totalVK = data.items.reduce((s, i) => s + i.menge * (i.product?.vk_preis ?? 0), 0)
  rows.push(['', '', '', '', 'GESAMT', '', totalEK, totalVK, totalVK])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 7 }, { wch: 16 }, { wch: 16 }, { wch: 14 }]

  // Stile
  const BLACK = '000000', WHITE = 'FFFFFF', GREY = '111111', LIGHTGREY = '1A1A1A', MUTED = '888888'
  // Dünner Rahmen für alle Tabellenzellen (Header + Daten + Gesamt)
  const gridBorder = {
    top:    { style: 'thin', color: { rgb: '333333' } },
    bottom: { style: 'thin', color: { rgb: '333333' } },
    left:   { style: 'thin', color: { rgb: '333333' } },
    right:  { style: 'thin', color: { rgb: '333333' } },
  }
  const titleStyle    = { font: { bold: true, color: { rgb: WHITE }, sz: 18, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: BLACK } } }
  const subtitleStyle = { font: { bold: true, color: { rgb: WHITE }, sz: 13, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: BLACK } } }
  const metaStyle     = { font: { color: { rgb: MUTED }, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: BLACK } } }
  const emptyStyle    = { fill: { patternType: 'solid', fgColor: { rgb: BLACK } } }
  const headerStyle   = { font: { bold: true, color: { rgb: WHITE }, sz: 10, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: GREY } },      alignment: { horizontal: 'left' },  border: gridBorder }
  const cellStyle     = { font: { color: { rgb: WHITE }, sz: 10, name: 'Arial' },              fill: { patternType: 'solid', fgColor: { rgb: LIGHTGREY } }, alignment: { horizontal: 'left' },  border: gridBorder }
  const numStyle      = { font: { color: { rgb: WHITE }, sz: 10, name: 'Arial' },              fill: { patternType: 'solid', fgColor: { rgb: LIGHTGREY } }, alignment: { horizontal: 'right' }, border: gridBorder }
  const totalStyle    = { font: { bold: true, color: { rgb: WHITE }, sz: 10, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: GREY } },      alignment: { horizontal: 'right' }, border: gridBorder }

  const cols = 9
  const colL = (i: number) => String.fromCharCode(65 + i)

  // Titelzeilen (ohne "Erstellt von" – nur 4 Metazeilen + 1 Leerzeile)
  for (let c = 0; c < cols; c++) S(ws, `${colL(c)}1`, titleStyle)
  for (let c = 0; c < cols; c++) S(ws, `${colL(c)}2`, subtitleStyle)
  for (let c = 0; c < cols; c++) S(ws, `${colL(c)}3`, metaStyle)
  for (let c = 0; c < cols; c++) S(ws, `${colL(c)}4`, metaStyle)
  for (let c = 0; c < cols; c++) S(ws, `${colL(c)}5`, emptyStyle)

  // Header
  for (let c = 0; c < cols; c++) S(ws, `${colL(c)}${headerRowIdx + 1}`, headerStyle)

  // Datenzeilen
  for (let r = headerRowIdx + 2; r <= rows.length; r++) {
    const row = rows[r - 1]
    if (!row || row.length === 0) continue
    const isTotal = String(row[4] ?? '') === 'GESAMT'
    if (isTotal) {
      for (let c = 0; c < cols; c++) S(ws, `${colL(c)}${r}`, totalStyle)
    } else {
      for (let c = 0; c < cols; c++) {
        S(ws, `${colL(c)}${r}`, c >= 5 ? numStyle : cellStyle)
      }
    }
  }

  // Merges für Titel
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 8 } },
  ]

  // Ungültige Zeichen für Excel Sheet-Namen entfernen: [ ] : * ? / \
  const sheetName = data.project.name
    .replace(/[[\]:*?/\\]/g, '')
    .trim()
    .substring(0, 31) || 'Export'
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  const filename = sanitizeFilename(data.project.name) + '.xlsx'
  downloadWorkbook(wb, filename)
}
