import { createClient } from '@supabase/supabase-js'

// ── Typen ──────────────────────────────────────────────────────
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

// ── Hilfsfunktionen ────────────────────────────────────────────
function mapStatus(p: ProSonataProject): 'aktiv' | 'pausiert' | 'abgeschlossen' {
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

function mapTyp(p: ProSonataProject): 'intern' | 'extern' {
  return /\(\s*intern\s*\)/i.test(p.customerName ?? '') ? 'intern' : 'extern'
}

// Alle Seiten einer ProSonata-Abfrage laden, mit AbortController-Timeout pro Request
async function fetchAllPages(
  apiKey: string,
  appID: string,
  extraParams = '',
  timeoutMs = 40_000,
): Promise<ProSonataProject[]> {
  const results: ProSonataProject[] = []
  let page = 1
  let lastPage = 1
  const headers: Record<string, string> = {
    'X-API-Key': apiKey.trim(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (appID) headers['X-APP-ID'] = appID.trim()

  do {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(
        `https://aufgemoebelt.prosonata.software/api/v1/projects?page=${page}&per_page=100${extraParams}`,
        { headers, signal: controller.signal },
      )
      if (!res.ok) throw new Error(`ProSonata API ${res.status}: ${res.statusText}`)
      const json = await res.json()
      results.push(...(json.data ?? []))
      lastPage = json.meta?.pagination?.last_page ?? 1
      page++
    } finally {
      clearTimeout(timer)
    }
  } while (page <= lastPage)

  return results
}

// ── Maximale Laufzeit: 60 s (erfordert Vercel Pro) ─────────────
export const config = { maxDuration: 60 }

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    }
  } else if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const apiKey = process.env.PROSONATA_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'PROSONATA_API_KEY fehlt in den Umgebungsvariablen.' })
  }
  const appID = process.env.PROSONATA_APP_ID ?? ''

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase-Zugangsdaten fehlen.' })
  }
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    // Aktive und inaktive Projekte nacheinander laden (nicht parallel) damit
    // der Gesamt-Timeout nicht schon nach dem ersten Fetch aufgebraucht ist
    console.log('[Sync] Lade aktive Projekte…')
    const active = await fetchAllPages(apiKey, appID)
    console.log(`[Sync] ${active.length} aktive Projekte`)

    console.log('[Sync] Lade weitere Projekte (projectStatus=0)…')
    const inactive = await fetchAllPages(apiKey, appID, '&projectStatus=0')
    console.log(`[Sync] ${inactive.length} weitere Projekte`)

    // Deduplizieren anhand projectID
    const seen = new Set<string>()
    const all: ProSonataProject[] = []
    for (const p of [...active, ...inactive]) {
      const id = String(p.projectID)
      if (!seen.has(id)) { seen.add(id); all.push(p) }
    }
    console.log(`[Sync] ${all.length} Projekte gesamt (nach Deduplizierung)`)

    if (all.length === 0) {
      return res.status(200).json({ ok: true, count: 0, message: 'Keine Projekte von ProSonata erhalten.' })
    }

    const upsertData = all.map(p => ({
      name: p.projectName,
      beschreibung: p.projectNo ? `Nr. ${p.projectNo}` : null,
      status: mapStatus(p),
      erstellt_von: null,
      enddatum: p.projectDateEnd || null,
      prosonata_id: String(p.projectID),
      typ: mapTyp(p),
    }))

    // Supabase-Upsert in kleinen Batches – Fehler eines Batches bricht nicht alle ab
    const BATCH = 200
    let saved = 0
    const batchErrors: string[] = []

    for (let i = 0; i < upsertData.length; i += BATCH) {
      const slice = upsertData.slice(i, i + BATCH)
      const { error } = await supabase
        .from('projects')
        .upsert(slice, { onConflict: 'prosonata_id' })
      if (error) {
        const msg = `Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`
        console.error('[Sync]', msg)
        batchErrors.push(msg)
      } else {
        saved += slice.length
      }
    }

    const syncedAt = new Date().toISOString()
    console.log(`[Sync] ${saved}/${all.length} gespeichert um ${syncedAt}`)

    if (batchErrors.length > 0) {
      // 207 = Partial Content – manche Batches fehlgeschlagen
      return res.status(207).json({ ok: false, count: saved, synced_at: syncedAt, errors: batchErrors })
    }

    return res.status(200).json({ ok: true, count: saved, synced_at: syncedAt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Sync] Kritischer Fehler:', msg)
    return res.status(500).json({ error: msg })
  }
}
