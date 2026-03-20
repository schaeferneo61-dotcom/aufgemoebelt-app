import * as XLSX from 'xlsx'
import type { Product, Project, ProjectItem } from '../types'

// ── IMPORT ──────────────────────────────────────────────────

/**
 * Parst eine Excel-Datei und gibt die Produkte als Array zurück.
 * Erwartet Spalten: Produkt, Stärke (mm), Maße (mm), m2/Lfm,
 *                   Händler, EK-Preis netto/Stk., VK-Preis netto/Stk., Stk/Palette
 */
export function parseProductExcel(file: File): Promise<Omit<Product, 'id' | 'created_at' | 'updated_at'>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows: Record<string, string | number | null>[] = XLSX.utils.sheet_to_json(sheet, {
          defval: null,
        })

        const products = rows
          .filter((row) => row['Produkt'] || row['produkt'] || row['PRODUKT'])
          .map((row) => {
            const get = (...keys: string[]) => {
              for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k]
              return null
            }
            const parseNum = (v: unknown) => {
              if (v === null || v === undefined || v === '') return null
              const n = parseFloat(String(v).replace(',', '.'))
              return isNaN(n) ? null : n
            }

            return {
              produkt: String(get('Produkt', 'produkt', 'PRODUKT') ?? '').trim(),
              staerke_mm: get('Stärke (mm)', 'Staerke (mm)', 'Stärke', 'staerke_mm') !== null
                ? String(get('Stärke (mm)', 'Staerke (mm)', 'Stärke', 'staerke_mm'))
                : null,
              masse_mm: get('Maße (mm)', 'Masse (mm)', 'Maße', 'masse_mm') !== null
                ? String(get('Maße (mm)', 'Masse (mm)', 'Maße', 'masse_mm'))
                : null,
              m2_lfm: get('m2/Lfm', 'm²/Lfm', 'm2_lfm') !== null
                ? String(get('m2/Lfm', 'm²/Lfm', 'm2_lfm'))
                : null,
              haendler: get('Händler', 'Haendler', 'haendler') !== null
                ? String(get('Händler', 'Haendler', 'haendler'))
                : null,
              ek_preis: parseNum(get('EK-Preis netto/Stk.', 'EK-Preis', 'ek_preis')),
              vk_preis: parseNum(get('VK-Preis netto/Stk.', 'VK-Preis', 'vk_preis')),
              stk_palette: get('Stk/Palette', 'Stk./Palette', 'stk_palette') !== null
                ? String(get('Stk/Palette', 'Stk./Palette', 'stk_palette'))
                : null,
              bestand: 0,
            }
          })
          .filter((p) => p.produkt.length > 0)

        resolve(products)
      } catch (err) {
        reject(new Error('Excel-Datei konnte nicht gelesen werden: ' + String(err)))
      }
    }
    reader.onerror = () => reject(new Error('Datei konnte nicht geöffnet werden'))
    reader.readAsArrayBuffer(file)
  })
}

// ── EXPORT ──────────────────────────────────────────────────

interface ExportData {
  project: Project
  items: (ProjectItem & { product: Product })[]
  creatorName?: string
}

/**
 * Erstellt eine Excel-Datei mit Projektübersicht und Positionen.
 */
export function exportProjectToExcel(data: ExportData): void {
  const workbook = XLSX.utils.book_new()

  // ── Tabellenblatt 1: Projektinfo ──
  const infoRows = [
    ['Projektname', data.project.name],
    ['Beschreibung', data.project.beschreibung ?? ''],
    ['Status', data.project.status],
    ['Erstellt von', data.creatorName ?? ''],
    ['Erstellt am', new Date(data.project.created_at).toLocaleDateString('de-AT')],
    ['Exportiert am', new Date().toLocaleDateString('de-AT')],
  ]
  const infoSheet = XLSX.utils.aoa_to_sheet(infoRows)
  infoSheet['!cols'] = [{ wch: 18 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(workbook, infoSheet, 'Projektinfo')

  // ── Tabellenblatt 2: Positionen ──
  const header = [
    'Produkt',
    'Stärke (mm)',
    'Maße (mm)',
    'm²/Lfm',
    'Händler',
    'Menge',
    'EK-Preis netto/Stk.',
    'VK-Preis netto/Stk.',
    'Stk/Palette',
    'Notiz',
    'Hinzugefügt am',
  ]

  const itemRows = data.items.map((item) => [
    item.product?.produkt ?? '',
    item.product?.staerke_mm ?? '',
    item.product?.masse_mm ?? '',
    item.product?.m2_lfm ?? '',
    item.product?.haendler ?? '',
    item.menge,
    item.product?.ek_preis ?? '',
    item.product?.vk_preis ?? '',
    item.product?.stk_palette ?? '',
    item.notiz ?? '',
    new Date(item.created_at).toLocaleDateString('de-AT'),
  ])

  // Gesamtsummen
  const totalEK = data.items.reduce((sum, i) => sum + (i.menge * (i.product?.ek_preis ?? 0)), 0)
  const totalVK = data.items.reduce((sum, i) => sum + (i.menge * (i.product?.vk_preis ?? 0)), 0)

  const posSheet = XLSX.utils.aoa_to_sheet([
    header,
    ...itemRows,
    [],
    ['', '', '', '', 'GESAMT', '', totalEK.toFixed(2), totalVK.toFixed(2)],
  ])
  posSheet['!cols'] = [
    { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 10 },
    { wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 20 },
    { wch: 12 }, { wch: 25 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(workbook, posSheet, 'Positionen')

  // Download triggern
  const filename = `Aufgemoebelt_${data.project.name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`
  XLSX.writeFile(workbook, filename)
}

/**
 * Exportiert alle Projekte in eine Übersichts-Excel-Datei.
 */
export function exportAllProjectsToExcel(
  projects: Project[],
  allItems: (ProjectItem & { product: Product })[],
): void {
  const workbook = XLSX.utils.book_new()

  // ── Übersicht ──
  const overviewHeader = ['Projektname', 'Status', 'Erstellt am', 'Anzahl Positionen']
  const overviewRows = projects.map((p) => [
    p.name,
    p.status,
    new Date(p.created_at).toLocaleDateString('de-AT'),
    allItems.filter((i) => i.project_id === p.id).length,
  ])
  const overviewSheet = XLSX.utils.aoa_to_sheet([overviewHeader, ...overviewRows])
  overviewSheet['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Übersicht')

  // ── Pro Projekt ein Blatt ──
  for (const project of projects) {
    const items = allItems.filter((i) => i.project_id === project.id)
    if (items.length === 0) continue

    const header = ['Produkt', 'Menge', 'EK-Preis netto/Stk.', 'VK-Preis netto/Stk.', 'Notiz']
    const rows = items.map((i) => [
      i.product?.produkt ?? '',
      i.menge,
      i.product?.ek_preis ?? '',
      i.product?.vk_preis ?? '',
      i.notiz ?? '',
    ])
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows])
    sheet['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 25 }]
    // Blattname max 31 Zeichen
    const sheetName = project.name.slice(0, 31)
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  }

  const filename = `Aufgemoebelt_Alle_Projekte_${new Date().toISOString().slice(0, 10)}.xlsx`
  XLSX.writeFile(workbook, filename)
}
