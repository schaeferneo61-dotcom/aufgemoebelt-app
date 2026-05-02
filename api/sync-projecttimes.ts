import { createClient } from '@supabase/supabase-js'

// ProSonata gibt je nach Version verschiedene Feldnamen zurück – alle abdecken
interface RawTime {
  projectTimeID?: number | string
  id?: number | string
  projectID?: number | string
  project_id?: number | string
  projectName?: string
  project_name?: string
  employeeID?: number | string
  employee_id?: number | string
  firstName?: string
  first_name?: string
  givenName?: string
  lastName?: string
  last_name?: string
  familyName?: string
  bookingDate?: string
  date?: string
  workDate?: string
  duration?: number
  hours?: number
  workHours?: number
  customerName?: string
  customer_name?: string
  [key: string]: unknown
}

export const config = { maxDuration: 60 }

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function currentWeekRange(): { from: string; to: string } {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { from: fmtDate(monday), to: fmtDate(sunday) }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const apiKey = process.env.PROSONATA_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'PROSONATA_API_KEY nicht konfiguriert' })
  const appID = process.env.PROSONATA_APP_ID ?? ''

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase-Zugangsdaten fehlen.' })
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Datumsbereich: aus Body oder aktuelle Woche
  const body = typeof req.body === 'object' ? req.body : {}
  const { from: reqFrom, to: reqTo } = body
  const defaultRange = currentWeekRange()
  const from: string = reqFrom || defaultRange.from
  const to: string = reqTo || defaultRange.to

  const headers: Record<string, string> = {
    'X-API-Key': apiKey.trim(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (appID) headers['X-APP-ID'] = appID.trim()

  try {
    const allTimes: RawTime[] = []
    let page = 1
    let lastPage = 1

    do {
      const url =
        `https://aufgemoebelt.prosonata.software/api/v1/projecttimes` +
        `?page=${page}&per_page=100&dateFrom=${from}&dateTo=${to}`
      const r = await fetch(url, { headers })
      if (!r.ok) {
        const text = await r.text().catch(() => r.statusText)
        throw new Error(`ProSonata API ${r.status}: ${text}`)
      }
      const json = await r.json()
      allTimes.push(...(json.data ?? []))
      lastPage = json.meta?.pagination?.last_page ?? 1
      page++
    } while (page <= lastPage)

    if (allTimes.length === 0) {
      return res.status(200).json({ ok: true, count: 0, from, to, message: 'Keine Einträge im Zeitraum.' })
    }

    type TimeRow = {
      prosonata_time_id: string
      date: string
      employee_id: string
      employee_first_name: string
      employee_last_name: string
      project_id: string
      project_name: string
      is_internal: boolean
      hours: number | null
      synced_at: string
    }

    const rows: TimeRow[] = allTimes
      .map((t): TimeRow | null => {
        const timeId = String(t.projectTimeID ?? t.id ?? '')
        if (!timeId) return null

        const date = String(t.bookingDate ?? t.date ?? t.workDate ?? '')
        if (!date) return null

        const customerName = String(t.customerName ?? t.customer_name ?? '')
        const isInternal = /\(\s*intern\s*\)/i.test(customerName)

        return {
          prosonata_time_id: timeId,
          date,
          employee_id: String(t.employeeID ?? t.employee_id ?? ''),
          employee_first_name: String(t.firstName ?? t.first_name ?? t.givenName ?? ''),
          employee_last_name: String(t.lastName ?? t.last_name ?? t.familyName ?? ''),
          project_id: String(t.projectID ?? t.project_id ?? ''),
          project_name: String(t.projectName ?? t.project_name ?? ''),
          is_internal: isInternal,
          hours: Number(t.duration ?? t.hours ?? t.workHours ?? 0) || null,
          synced_at: new Date().toISOString(),
        }
      })
      .filter((r): r is TimeRow => r !== null)

    // In Batches upserten
    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase
        .from('project_times')
        .upsert(rows.slice(i, i + BATCH), { onConflict: 'prosonata_time_id' })
      if (error) throw new Error('Supabase: ' + error.message)
    }

    console.log(`[sync-projecttimes] ${rows.length} Einträge für ${from}–${to} synchronisiert`)
    return res.status(200).json({ ok: true, count: rows.length, from, to })
  } catch (err) {
    console.error('[sync-projecttimes]', String(err))
    return res.status(500).json({ error: String(err) })
  }
}
