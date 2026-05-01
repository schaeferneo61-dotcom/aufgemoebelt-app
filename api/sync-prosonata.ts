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

// ── Hilfsfunktionen (identisch zu src/lib/prosonata.ts) ────────
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

async function fetchAllPages(apiKey: string, appID: string, extraParams = ''): Promise<ProSonataProject[]> {
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
    const res = await fetch(
      `https://aufgemoebelt.prosonata.software/api/v1/projects?page=${page}&per_page=100${extraParams}`,
      { headers }
    )
    if (!res.ok) throw new Error(`ProSonata API ${res.status}: ${res.statusText}`)
    const json = await res.json()
    results.push(...(json.data ?? []))
    lastPage = json.meta?.pagination?.last_page ?? 1
    page++
  } while (page <= lastPage)
  return results
}

// ── Maximale Laufzeit: 60 Sekunden ────────────────────────────
export const config = { maxDuration: 60 }

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    // Automatischer Cron: CRON_SECRET prüfen (Vercel setzt es automatisch)
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
    }
  } else if (req.method !== 'POST') {
    // POST = manueller Trigger aus der App (kein Secret nötig)
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  // API-Key und App-ID aus Umgebungsvariablen
  const apiKey = process.env.PROSONATA_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'PROSONATA_API_KEY ist nicht konfiguriert. Bitte in Vercel → Settings → Environment Variables eintragen.' })
  }
  const appID = process.env.PROSONATA_APP_ID ?? ''

  // Supabase-Client (server-seitig)
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase-Zugangsdaten fehlen.' })
  }
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const [active, inactive] = await Promise.all([
      fetchAllPages(apiKey, appID),
      fetchAllPages(apiKey, appID, '&projectStatus=0'),
    ])

    // Deduplizieren
    const seen = new Set<string>()
    const all: ProSonataProject[] = []
    for (const p of [...active, ...inactive]) {
      const id = String(p.projectID)
      if (!seen.has(id)) { seen.add(id); all.push(p) }
    }

    if (all.length === 0) {
      return res.status(200).json({ ok: true, count: 0, message: 'Keine Projekte gefunden.' })
    }

    // In Supabase speichern (in Batches)
    const upsertData = all.map(p => ({
      name: p.projectName,
      beschreibung: p.projectNo ? `Nr. ${p.projectNo}` : null,
      status: mapStatus(p),
      erstellt_von: null,
      enddatum: p.projectDateEnd || null,
      prosonata_id: String(p.projectID),
      typ: mapTyp(p),
    }))

    const BATCH = 500
    for (let i = 0; i < upsertData.length; i += BATCH) {
      const { error } = await supabase
        .from('projects')
        .upsert(upsertData.slice(i, i + BATCH), { onConflict: 'prosonata_id' })
      if (error) throw new Error('Supabase: ' + error.message)
    }

    const syncedAt = new Date().toISOString()
    console.log(`[ProSonata Auto-Sync] ${all.length} Projekte synchronisiert um ${syncedAt}`)

    return res.status(200).json({ ok: true, count: all.length, synced_at: syncedAt })
  } catch (err) {
    console.error('[ProSonata Auto-Sync] Fehler:', String(err))
    return res.status(500).json({ error: String(err) })
  }
}
