import * as XLSX from 'xlsx'
import type { Product, Project, ProjectItem } from '../types'

// ── IMPORT ──────────────────────────────────────────────────

// verfuegbar wird NICHT aus Excel gelesen – DB-Trigger berechnet es atomar
type ParsedProduct = Omit<Product, 'id' | 'created_at' | 'updated_at' | 'verfuegbar'>

function parseRows(data: Uint8Array): ParsedProduct[] {
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
  const colBestand   = findCol('bestand', 'anzahl', 'lager', 'vorrat', 'stück', 'stuck', 'qty', 'quantity')

  // Erster Spaltenindex (für Kategorien-Erkennung)
  const firstCol = colProdukt >= 0 ? colProdukt : 0

  let currentKategorie: string | null = null
  const result: ParsedProduct[] = []

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
      bestand: colBestand >= 0 ? (parseNum(row[colBestand]) ?? 0) : 0,
      // verfuegbar wird NICHT gesetzt – BEFORE INSERT Trigger setzt verfuegbar = bestand,
      // AFTER UPDATE OF bestand Trigger recalculiert verfuegbar bei Updates
    })
  }

  return result.filter((p) => p.produkt.length > 0)
}

export async function parseProductExcelFromUrl(url: string): Promise<ParsedProduct[]> {
  const downloadUrl = url.includes('download=1') ? url : url + (url.includes('?') ? '&' : '?') + 'download=1'
  const response = await fetch(downloadUrl)
  if (!response.ok) throw new Error('Datei konnte nicht geladen werden (Status ' + response.status + ')')
  const buffer = await response.arrayBuffer()
  const data = new Uint8Array(buffer)
  return parseRows(data)
}

export function parseProductExcel(file: File): Promise<ParsedProduct[]> {
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

// ── Bestand-Export (aktueller Stand aus DB) ──────────────────

export function exportBestandToExcel(products: Product[]): void {
  const wb = XLSX.utils.book_new()
  const rows: (string | number)[][] = []

  const BLACK = '000000', WHITE = 'FFFFFF', GREY = '111111', LIGHTGREY = '1A1A1A', MUTED = '888888'
  const RED = 'FF4444', YELLOW = 'FFAA00', GREEN = '44BB88'

  // Titel
  const today = new Date().toLocaleDateString('de-AT')
  rows.push(['aufgemoebelt – Aktueller Lagerbestand', '', '', '', '', '', ''])
  rows.push([`Stand: ${today}`, '', '', '', '', '', ''])
  rows.push([]) // Leerzeile

  // Header
  rows.push(['Ware', 'Kategorie', 'Händler', 'Bestand (Original)', 'Verbucht', 'Verfügbar', 'Status'])
  const headerRowIdx = rows.length - 1

  const sorted = [...products].sort((a, b) =>
    (a.kategorie ?? '').localeCompare(b.kategorie ?? '', 'de') ||
    a.produkt.localeCompare(b.produkt, 'de')
  )

  for (const p of sorted) {
    const verbucht = Math.max(0, p.bestand - p.verfuegbar)
    const status = p.verfuegbar <= 0 ? 'Nicht verfügbar' : p.verfuegbar <= 5 ? 'Niedrig' : 'OK'
    rows.push([p.produkt, p.kategorie ?? '', p.haendler ?? '', p.bestand, verbucht, p.verfuegbar, status])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 36 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 16 }]

  const cols = 7
  const colL = (i: number) => String.fromCharCode(65 + i)
  const gridBorder = {
    top: { style: 'thin', color: { rgb: '333333' } }, bottom: { style: 'thin', color: { rgb: '333333' } },
    left: { style: 'thin', color: { rgb: '333333' } }, right: { style: 'thin', color: { rgb: '333333' } },
  }

  const S = (ref: string, style: object) => {
    if (!ws[ref]) ws[ref] = { v: '', t: 's' }
    ws[ref].s = style
  }

  const titleStyle  = { font: { bold: true, color: { rgb: WHITE }, sz: 14, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: BLACK } } }
  const dateStyle   = { font: { color: { rgb: MUTED }, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: BLACK } } }
  const emptyStyle  = { fill: { patternType: 'solid', fgColor: { rgb: BLACK } } }
  const headerStyle = { font: { bold: true, color: { rgb: WHITE }, sz: 10, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: GREY } }, alignment: { horizontal: 'center' }, border: gridBorder }
  const cellStyle   = { font: { color: { rgb: WHITE }, sz: 10, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: LIGHTGREY } }, alignment: { horizontal: 'left' }, border: gridBorder }
  const numStyle    = { font: { color: { rgb: WHITE }, sz: 10, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: LIGHTGREY } }, alignment: { horizontal: 'center' }, border: gridBorder }

  for (let c = 0; c < cols; c++) S(`${colL(c)}1`, titleStyle)
  for (let c = 0; c < cols; c++) S(`${colL(c)}2`, dateStyle)
  for (let c = 0; c < cols; c++) S(`${colL(c)}3`, emptyStyle)
  for (let c = 0; c < cols; c++) S(`${colL(c)}${headerRowIdx + 1}`, headerStyle)

  for (let r = headerRowIdx + 2; r <= rows.length; r++) {
    const row = rows[r - 1]
    if (!row || row.length === 0) continue
    const status = String(row[6] ?? '')
    const statusColor = status === 'Nicht verfügbar' ? RED : status === 'Niedrig' ? YELLOW : GREEN
    for (let c = 0; c < cols - 1; c++) {
      S(`${colL(c)}${r}`, c >= 3 ? numStyle : cellStyle)
    }
    // Status-Spalte farbig
    S(`${colL(6)}${r}`, {
      font: { bold: true, color: { rgb: statusColor }, sz: 10, name: 'Arial' },
      fill: { patternType: 'solid', fgColor: { rgb: LIGHTGREY } },
      alignment: { horizontal: 'center' },
      border: gridBorder,
    })
  }

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Lagerbestand')

  const filename = `Lagerbestand_${today.replace(/\./g, '-')}.xlsx`
  downloadWorkbook(wb, filename)
}

// ── Verbrauchsbericht-Export (Zeitraum, aggregiert) ──────────

export interface VerbrauchRow {
  produkt: string
  kategorie: string | null
  haendler: string | null
  staerke_mm: string | null
  masse_mm: string | null
  ek_preis: number | null
  vk_preis: number | null
  total_menge: number
}

export function exportVerbrauchToExcel(rows: VerbrauchRow[], startDate: string, endDate: string): void {
  const wb = XLSX.utils.book_new()
  const ws: XLSX.WorkSheet = {}

  // ── Farben ───────────────────────────────────────────────
  const BLACK  = '000000'
  const WHITE  = 'FFFFFF'
  const G2     = '131313'   // Datenzeile (gerade)
  const G3     = '1B1B1B'   // Datenzeile (ungerade)
  const G4     = '181818'   // Kategorie-Header
  const MUTED  = '777777'   // Dezenter Text
  const MUTED2 = '444444'   // Noch dezenter
  const BDR    = '2E2E2E'   // Zellen-Rahmen
  const BDM    = '3C3C3C'   // Separator-Linie
  const STATBG = '0A0A0A'   // Stat-Box Hintergrund

  const NUM_COLS = 9
  const colL = (i: number) => String.fromCharCode(65 + i)

  const merges: XLSX.Range[] = []
  const rowHeights: { hpt: number }[] = []

  // Zeilenhoehe setzen (1-basiert)
  const setRow = (r: number, hpt: number) => {
    while (rowHeights.length < r) rowHeights.push({ hpt: 14 })
    rowHeights[r - 1] = { hpt }
  }

  // Zelle setzen
  const cell = (ref: string, v: string | number, t: 's' | 'n', s: object) => {
    ws[ref] = { v, t, s }
  }

  // Leere Zelle mit Stil
  const blank = (ref: string, s: object) => {
    ws[ref] = { v: '', t: 's', s }
  }

  // Merge hinzufuegen (1-basiert, 0-basierte Spalten)
  const mg = (r1: number, c1: number, r2: number, c2: number) => {
    merges.push({ s: { r: r1 - 1, c: c1 }, e: { r: r2 - 1, c: c2 } })
  }

  // Ganze Zeile fuellen
  const fillRow = (r: number, s: object) => {
    for (let c = 0; c < NUM_COLS; c++) blank(`${colL(c)}${r}`, s)
  }

  // ── Formatierungshelfer ─────────────────────────────────────────
  const fmtDate = (d: string) => {
    const [y, m, day] = d.split('-')
    return `${day}.${m}.${y}`
  }

  const fmtEur = (n: number): string => {
    if (n === 0) return '–'
    const [int, dec] = n.toFixed(2).split('.')
    return `€ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
  }

  const startFmt = fmtDate(startDate)
  const endFmt   = fmtDate(endDate)
  const today    = new Date()
  const pad      = (n: number) => String(n).padStart(2, '0')
  const todayFmt = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`

  // ── Statistiken ──────────────────────────────────────────────────────────
  const totalMenge  = rows.reduce((s, r) => s + r.total_menge, 0)
  const totalEK     = rows.reduce((s, r) => s + r.total_menge * (r.ek_preis ?? 0), 0)
  const totalVK     = rows.reduce((s, r) => s + r.total_menge * (r.vk_preis ?? 0), 0)
  const numArtikel  = rows.length

  // ── Basis-Stile ────────────────────────────────────────────────────────────
  const sBg = (rgb: string) => ({ fill: { patternType: 'solid', fgColor: { rgb } } })

  const sBrand = {
    font:      { bold: true, color: { rgb: WHITE }, sz: 24, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: BLACK } },
    alignment: { horizontal: 'left', vertical: 'center' },
  }
  const sSubtitle = {
    font:      { color: { rgb: MUTED }, sz: 10, name: 'Arial', italic: true },
    fill:      { patternType: 'solid', fgColor: { rgb: BLACK } },
    alignment: { horizontal: 'left', vertical: 'center' },
  }
  const sExportDate = {
    font:      { color: { rgb: MUTED2 }, sz: 8, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: BLACK } },
    alignment: { horizontal: 'left', vertical: 'center' },
  }
  const sSep = {
    fill: { patternType: 'solid', fgColor: { rgb: BDM } },
  }

  // Stat-Box: Beschriftung oben
  const sStatLabel = {
    font:      { bold: true, color: { rgb: MUTED }, sz: 7, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: STATBG } },
    alignment: { horizontal: 'center', vertical: 'bottom' },
    border: {
      top:   { style: 'thin', color: { rgb: BDR } },
      left:  { style: 'thin', color: { rgb: BDR } },
      right: { style: 'thin', color: { rgb: BDR } },
    },
  }

  // Stat-Box: Wert unten
  const sStatValue = {
    font:      { bold: true, color: { rgb: WHITE }, sz: 16, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: STATBG } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
      bottom: { style: 'thin', color: { rgb: BDR } },
      left:   { style: 'thin', color: { rgb: BDR } },
      right:  { style: 'thin', color: { rgb: BDR } },
    },
  }

  // Tabellen-Header
  const sThBase = {
    font:      { bold: true, color: { rgb: MUTED }, sz: 8, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: G4 } },
    border:    { bottom: { style: 'medium', color: { rgb: BDM } } },
  }
  const sTh  = { ...sThBase, alignment: { horizontal: 'center', vertical: 'center' } }
  const sThL = { ...sThBase, alignment: { horizontal: 'left',   vertical: 'center' } }
  const sThR = { ...sThBase, alignment: { horizontal: 'right',  vertical: 'center' } }

  // Kategorie-Header
  const sCatHdr = {
    font:      { bold: true, color: { rgb: MUTED }, sz: 8, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: G4 } },
    alignment: { horizontal: 'left', vertical: 'center' },
  }

  // Datenzellen
  const sDL = (fg: string) => ({
    font:      { color: { rgb: WHITE }, sz: 9, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: fg } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border:    { bottom: { style: 'thin', color: { rgb: BDR } } },
  })
  const sDC = (fg: string) => ({
    font:      { color: { rgb: WHITE }, sz: 9, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: fg } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border:    { bottom: { style: 'thin', color: { rgb: BDR } } },
  })
  const sDR = (fg: string) => ({
    font:      { color: { rgb: WHITE }, sz: 9, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: fg } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border:    { bottom: { style: 'thin', color: { rgb: BDR } } },
  })
  const sDM = (fg: string) => ({
    font:      { color: { rgb: MUTED2 }, sz: 9, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: fg } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border:    { bottom: { style: 'thin', color: { rgb: BDR } } },
  })

  // Gesamt-Zeile
  const sTotLabel = {
    font:      { bold: true, color: { rgb: WHITE }, sz: 10, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: BLACK } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: {
      top:    { style: 'medium', color: { rgb: BDM } },
      bottom: { style: 'thin',   color: { rgb: BDR } },
    },
  }
  const sTotNum = {
    font:      { bold: true, color: { rgb: WHITE }, sz: 10, name: 'Arial' },
    fill:      { patternType: 'solid', fgColor: { rgb: BLACK } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: {
      top:    { style: 'medium', color: { rgb: BDM } },
      bottom: { style: 'thin',   color: { rgb: BDR } },
    },
  }

  const sFooter = {
    font:      { color: { rgb: MUTED2 }, sz: 8, name: 'Arial', italic: true },
    fill:      { patternType: 'solid', fgColor: { rgb: BLACK } },
    alignment: { horizontal: 'left', vertical: 'center' },
  }

  // ── Aufbau ──────────────────────────────────────────────────────────────────
  let R = 1

  // R1 — Brand-Header
  setRow(R, 44)
  cell(`A${R}`, 'AUFGEMÖBELT', 's', sBrand)
  for (let c = 1; c < NUM_COLS; c++) blank(`${colL(c)}${R}`, sBg(BLACK))
  mg(R, 0, R, 8)
  R++

  // R2 — Untertitel
  setRow(R, 20)
  cell(`A${R}`, `Verbrauchsbericht  ·  ${startFmt} – ${endFmt}`, 's', sSubtitle)
  for (let c = 1; c < NUM_COLS; c++) blank(`${colL(c)}${R}`, sBg(BLACK))
  mg(R, 0, R, 8)
  R++

  // R3 — Export-Datum
  setRow(R, 14)
  cell(`A${R}`, `Exportiert am ${todayFmt}`, 's', sExportDate)
  for (let c = 1; c < NUM_COLS; c++) blank(`${colL(c)}${R}`, sBg(BLACK))
  mg(R, 0, R, 8)
  R++

  // R4 — Trennlinie
  setRow(R, 4)
  fillRow(R, sSep)
  R++

  // R5 — Stat-Beschriftungen  [A–B] ARTIKEL | [C–D] GESAMTMENGE | [E] Lücke | [F–G] EK GESAMT | [H–I] VK GESAMT
  setRow(R, 13)
  cell(`A${R}`, 'ARTIKEL',     's', sStatLabel); blank(`B${R}`, sStatLabel); mg(R, 0, R, 1)
  cell(`C${R}`, 'GESAMTMENGE', 's', sStatLabel); blank(`D${R}`, sStatLabel); mg(R, 2, R, 3)
  blank(`E${R}`, sBg(BLACK))
  cell(`F${R}`, 'EK GESAMT',   's', sStatLabel); blank(`G${R}`, sStatLabel); mg(R, 5, R, 6)
  cell(`H${R}`, 'VK GESAMT',   's', sStatLabel); blank(`I${R}`, sStatLabel); mg(R, 7, R, 8)
  R++

  // R6 — Stat-Werte
  setRow(R, 30)
  cell(`A${R}`, String(numArtikel),  's', sStatValue); blank(`B${R}`, sStatValue); mg(R, 0, R, 1)
  cell(`C${R}`, String(totalMenge),  's', sStatValue); blank(`D${R}`, sStatValue); mg(R, 2, R, 3)
  blank(`E${R}`, sBg(BLACK))
  cell(`F${R}`, fmtEur(totalEK),    's', sStatValue); blank(`G${R}`, sStatValue); mg(R, 5, R, 6)
  cell(`H${R}`, fmtEur(totalVK),    's', sStatValue); blank(`I${R}`, sStatValue); mg(R, 7, R, 8)
  R++

  // R7 — Abstand
  setRow(R, 10)
  fillRow(R, sBg(BLACK))
  R++

  // R8 — Tabellen-Header
  setRow(R, 22)
  const HEADERS  = ['WARE', 'KATEGORIE', 'HÄNDLER', 'STÄRKE', 'MASSE', 'MENGE', 'EK / STK', 'VK / STK', 'GESAMT VK']
  const H_STYLES = [sThL, sThL, sThL, sTh, sTh, sTh, sThR, sThR, sThR]
  for (let c = 0; c < NUM_COLS; c++) cell(`${colL(c)}${R}`, HEADERS[c], 's', H_STYLES[c])
  R++

  // R9+ — Datenzeilen nach Kategorie gruppiert
  const grouped = new Map<string, VerbrauchRow[]>()
  for (const row of rows) {
    const kat = row.kategorie ?? 'Sonstige'
    if (!grouped.has(kat)) grouped.set(kat, [])
    grouped.get(kat)!.push(row)
  }
  const sortedCats = [...grouped.keys()].sort()

  let rowIdx = 0
  for (const kat of sortedCats) {
    const catRows = grouped.get(kat)!

    // Kategorie-Header
    setRow(R, 16)
    cell(`A${R}`, kat.toUpperCase(), 's', sCatHdr)
    for (let c = 1; c < NUM_COLS; c++) blank(`${colL(c)}${R}`, sCatHdr)
    mg(R, 0, R, 8)
    R++

    for (const row of catRows) {
      setRow(R, 18)
      const fg = rowIdx % 2 === 0 ? G2 : G3

      cell(`A${R}`, row.produkt,         's', sDL(fg))
      cell(`B${R}`, row.kategorie ?? '', 's', sDM(fg))
      cell(`C${R}`, row.haendler ?? '',  's', sDM(fg))
      cell(`D${R}`, row.staerke_mm ?? '','s', sDC(fg))
      cell(`E${R}`, row.masse_mm ?? '',  's', sDC(fg))
      cell(`F${R}`, row.total_menge,     'n', sDR(fg))

      if (row.ek_preis != null) {
        cell(`G${R}`, row.ek_preis, 'n', sDR(fg))
      } else {
        blank(`G${R}`, sDR(fg))
      }
      if (row.vk_preis != null) {
        cell(`H${R}`, row.vk_preis, 'n', sDR(fg))
        cell(`I${R}`, +(row.total_menge * row.vk_preis).toFixed(2), 'n', sDR(fg))
      } else {
        blank(`H${R}`, sDR(fg))
        blank(`I${R}`, sDR(fg))
      }

      rowIdx++
      R++
    }
  }

  // Trennlinie vor GESAMT
  setRow(R, 4)
  fillRow(R, sSep)
  R++

  // GESAMT-Zeile
  setRow(R, 22)
  cell(`A${R}`, 'GESAMT', 's', sTotLabel)
  for (let c = 1; c <= 4; c++) blank(`${colL(c)}${R}`, sTotLabel)
  mg(R, 0, R, 4)
  cell(`F${R}`, totalMenge,       'n', sTotNum)
  cell(`G${R}`, fmtEur(totalEK), 's', sTotNum)
  blank(`H${R}`, sTotNum)
  cell(`I${R}`, fmtEur(totalVK), 's', sTotNum)
  R++

  // Abstand
  setRow(R, 8)
  fillRow(R, sBg(BLACK))
  R++

  // Footer
  setRow(R, 14)
  cell(`A${R}`, 'Erstellt mit aufgemoebelt · Lager-App', 's', sFooter)
  for (let c = 1; c < NUM_COLS; c++) blank(`${colL(c)}${R}`, sBg(BLACK))
  mg(R, 0, R, 8)

  // ── Sheet-Metadaten ───────────────────────────────────────────────────
  ws['!ref']    = `A1:${colL(NUM_COLS - 1)}${R}`
  ws['!merges'] = merges
  ws['!rows']   = rowHeights
  ws['!cols']   = [
    { wch: 36 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 14 },
    { wch: 8  }, { wch: 13 }, { wch: 13 }, { wch: 14 },
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Verbrauch')
  const filename = `Verbrauch_${startFmt.replace(/\./g, '-')}_bis_${endFmt.replace(/\./g, '-')}.xlsx`
  downloadWorkbook(wb, filename)
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
