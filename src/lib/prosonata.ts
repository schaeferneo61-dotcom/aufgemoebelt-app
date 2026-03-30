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

function isInternValue(value: string): boolean {
  return /\(\s*intern\s*\)/i.test(value)
}

function containsIntern(obj: unknown, depth = 0): boolean {
  if (depth > 6) return false
  if (typeof obj === 'string') return isInternValue(obj)
  if (typeof obj !== 'object' || obj === null) return false
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (containsIntern(val, depth + 1)) return true
  }
  return false
}

const TOP_LEVEL_SKIP = new Set([
  'projectid', 'projectname', 'projectno', 'projectnumber',
  'projectdatestart', 'projectdateend', 'projectdatefrom', 'projectdateto',
  'projectstatus', 'activestatus',
])

export function mapProSonataTyp(raw: ProSonataProject): 'intern' | 'extern' {
  const projektName = String((raw as Record<string, unknown>).projectName ?? '')

  for (const [key, value] of Object.entries(raw)) {
    if (TOP_LEVEL_SKIP.has(key.toLowerCase())) continue
    if (containsIntern(value, 0)) {
      console.log(`[ProSonata] ✓ intern via "${key}" =`, JSON.stringify(value).substring(0, 100), '| Projekt:', projektName)
      return 'intern'
    }
  }
  return 'extern'
}

export function shouldAutoSync(): boolean {
  const lastSync = localStorage.getItem(PROSONATA_LAST_SYNC_TS)
  if (!lastSync) return true
  return Date.now() - parseInt(lastSync) > SYNC_COOLDOWN_MS
}

export async function syncProSonata(apiKey: string): Promise<{ count: number; error?: string }> {
  try {
    const allProjects: ProSonataProject[] = []
    let page = 1
    let lastPage = 1

    do {
      // Statt direktem Fetch → Supabase Edge Function als Proxy
      const { data, error } = await supabase.functions.invoke('prosonata-sync', {
        body: { apiKey: apiKey.trim(), page },
      })

      if (error) throw new Error('Verbindungsfehler: ' + error.message)
      if (data?.error) throw new Error(data.error)

      allProjects.push(...(data?.data ?? []))
      lastPage = data?.meta?.pagination?.last_page ?? 1
      page++
    } while (page <= lastPage)

    if (allProjects.length > 0) {
      console.log('[ProSonata] Felder des ersten Projekts:', Object.keys(allProjects[0]))
      console.log('[ProSonata] Erstes Projekt (komplett):', JSON.parse(JSON.stringify(allProjects[0])))
      const internCount = allProjects.filter(p => mapProSonataTyp(p) === 'intern').length
      console.log(`[ProSonata] Intern erkannt: ${internCount} / ${allProjects.length}`)
    }

    if (allProjects.length === 0) {
      return { count: 0, error: 'Keine Projekte in ProSonata gefunden.' }
    }

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
