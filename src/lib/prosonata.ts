import { supabase } from './supabase'

export const PROSONATA_KEY = 'prosonata_api_key'
export const PROSONATA_LAST_SYNC = 'prosonata_last_sync'
export const PROSONATA_LAST_SYNC_TS = 'prosonata_last_sync_ts'
export const SYNC_COOLDOWN_MS = 2 * 60 * 1000 // 2 Minuten

interface ProSonataProject {
  projectID: number | string
  projectName: string
  projectDateEnd: string | null
  projectStatus: number
  activeStatus: number
  projectNo?: string
  customerName?: string
  [key: string]: unknown
}

export function mapProSonataStatus(p: ProSonataProject): 'aktiv' | 'pausiert' | 'abgeschlossen' {
  if (p.projectDateEnd) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(23, 59, 59, 999)
    if (new Date(p.projectDateEnd) <= yesterday) return 'abgeschlossen'
  }
  if (p.projectStatus === 2 || p.projectStatus === 3) return 'abgeschlossen'
  if (p.activeStatus === 0) return 'pausiert'
  return 'aktiv'
}

// Intern = Firma/Gruppe in ProSonata enthält "(intern)" (z.B. "aufgemoebelt (intern)")
export function mapProSonataTyp(raw: ProSonataProject): 'intern' | 'extern' {
  const customerName = raw.customerName ?? ''
  return /\(\s*intern\s*\)/i.test(customerName) ? 'intern' : 'extern'
}

export function shouldAutoSync(): boolean {
  const lastSync = localStorage.getItem(PROSONATA_LAST_SYNC_TS)
  if (!lastSync) return true
  return Date.now() - parseInt(lastSync) > SYNC_COOLDOWN_MS
}

async function fetchAllPages(apiKey: string, extraParams = ''): Promise<ProSonataProject[]> {
  const results: ProSonataProject[] = []
  let page = 1
  let lastPage = 1
  const headers = {
    'X-API-Key': apiKey.trim(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  do {
    const res = await fetch(
      `https://aufgemoebelt.prosonata.software/api/v1/projects?page=${page}&per_page=100${extraParams}`,
      { headers }
    )
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`ProSonata API Fehler ${res.status}: ${errText || res.statusText}`)
    }
    const json = await res.json()
    results.push(...(json.data ?? []))
    lastPage = json.meta?.pagination?.last_page ?? 1
    page++
  } while (page <= lastPage)
  return results
}

export async function syncProSonata(apiKey: string): Promise<{ count: number; error?: string }> {
  try {
    // Aktive Projekte (Standard-Aufruf, kein Status-Filter = projectStatus 1)
    const activeProjects = await fetchAllPages(apiKey)

    // Inaktive Projekte (projectStatus=0) – hier sind die internen aufgemoebelt-Projekte
    const inactiveProjects = await fetchAllPages(apiKey, '&projectStatus=0')

    // Zusammenführen und nach projectID deduplizieren
    const seen = new Set<string>()
    const allProjects: ProSonataProject[] = []
    for (const p of [...activeProjects, ...inactiveProjects]) {
      const id = String(p.projectID)
      if (!seen.has(id)) {
        seen.add(id)
        allProjects.push(p)
      }
    }

    if (allProjects.length === 0) {
      return { count: 0, error: 'Keine Projekte in ProSonata gefunden.' }
    }

    const internCount = allProjects.filter(p => mapProSonataTyp(p) === 'intern').length
    console.log(`[ProSonata] Gesamt: ${allProjects.length} | Intern: ${internCount} | Extern: ${allProjects.length - internCount}`)

    const upsertData = allProjects.map((p) => ({
      name: p.projectName,
      beschreibung: p.projectNo ? `Nr. ${p.projectNo}` : null,
      status: mapProSonataStatus(p),
      erstellt_von: null,
      enddatum: p.projectDateEnd || null,
      prosonata_id: String(p.projectID),
      typ: mapProSonataTyp(p),
    }))

    const BATCH = 500
    for (let i = 0; i < upsertData.length; i += BATCH) {
      const batch = upsertData.slice(i, i + BATCH)
      const { error } = await supabase
        .from('projects')
        .upsert(batch, { onConflict: 'prosonata_id' })
      if (error) throw new Error('Supabase Fehler: ' + error.message)
    }

    const now = new Date().toLocaleString('de-AT')
    localStorage.setItem(PROSONATA_LAST_SYNC, now)
    localStorage.setItem(PROSONATA_LAST_SYNC_TS, String(Date.now()))

    return { count: allProjects.length }
  } catch (err) {
    return { count: 0, error: String(err) }
  }
}
