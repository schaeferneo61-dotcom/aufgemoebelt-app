import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'

// ── Datum-Hilfsfunktionen ─────────────────────────────────────

const MONTH_NAMES = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

function getEaster(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function getAustrianHolidays(year: number): Set<string> {
  const h = new Set<string>()
  const fmtD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const addD = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
  ;[
    `${year}-01-01`, `${year}-01-06`, `${year}-05-01`, `${year}-08-15`,
    `${year}-10-26`, `${year}-11-01`, `${year}-12-08`, `${year}-12-25`, `${year}-12-26`,
  ].forEach(s => h.add(s))
  const easter = getEaster(year)
  h.add(fmtD(addD(easter, 1)))   // Ostermontag
  h.add(fmtD(addD(easter, 39)))  // Christi Himmelfahrt
  h.add(fmtD(addD(easter, 50)))  // Pfingstmontag
  h.add(fmtD(addD(easter, 60)))  // Fronleichnam
  return h
}

function isWeekend(d: Date) { const day = d.getDay(); return day === 0 || day === 6 }

// ── Typen ─────────────────────────────────────────────────────

interface ProjectTime {
  id: string
  date: string
  employee_id: string | null
  employee_first_name: string | null
  employee_last_name: string | null
  project_id: string | null
  project_name: string | null
  is_internal: boolean
  hours: number | null
}

// ── Hauptkomponente ────────────────────────────────────────────

export function ArbeitszeitPage() {
  const { isAdminOrProjektleiter, profile } = useAuth()
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))

  const days = useMemo(() => getWeekDays(weekStart), [weekStart])
  const holidays = useMemo(() => {
    const years = new Set(days.map(d => d.getFullYear()))
    const all = new Set<string>()
    for (const y of years) getAustrianHolidays(y).forEach(h => all.add(h))
    return all
  }, [days])

  const weekLabel = useMemo(() => {
    const from = days[0]
    const to = days[6]
    const fromStr = `${from.getDate()}. ${MONTH_NAMES[from.getMonth()]}`
    const toStr = `${to.getDate()}. ${MONTH_NAMES[to.getMonth()]} ${to.getFullYear()}`
    return `${fromStr} – ${toStr}`
  }, [days])

  const prevWeek = () => {
    setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d })
  }
  const nextWeek = () => {
    setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d })
  }

  return (
    <div className="min-h-screen bg-black overflow-x-hidden">
      <Header />
      <main
        className="max-w-7xl mx-auto px-4"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 4rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)',
        }}
      >
        {/* Seitenheader */}
        <div className="border-b border-border pb-8 mb-8 mt-6">
          <h1 className="font-raleway font-semibold text-white text-2xl sm:text-3xl uppercase tracking-widest">
            Arbeitszeit
          </h1>
          <p className="text-muted font-opensans text-sm mt-1">
            {isAdminOrProjektleiter
              ? 'Übersicht aller Mitarbeiter · Daten aus ProSonata (Beta)'
              : 'Meine gebuchten Zeiten · Daten aus ProSonata (Beta)'}
          </p>
        </div>

        {/* Wochennavigation */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={prevWeek}
            className="border border-border text-white w-9 h-9 flex items-center justify-center font-raleway hover:bg-white hover:text-black transition-colors text-sm"
          >
            ←
          </button>
          <span className="font-opensans text-sm text-white min-w-[240px] text-center">
            {weekLabel}
          </span>
          <button
            onClick={nextWeek}
            className="border border-border text-white w-9 h-9 flex items-center justify-center font-raleway hover:bg-white hover:text-black transition-colors text-sm"
          >
            →
          </button>
        </div>

        {isAdminOrProjektleiter ? (
          <MatrixView days={days} holidays={holidays} weekStart={weekStart} />
        ) : (
          <MeineView days={days} holidays={holidays} weekStart={weekStart} profile={profile} />
        )}
      </main>
    </div>
  )
}

// ── Matrix-Ansicht (Admin / Projektleitung) ────────────────────

function MatrixView({
  days,
  holidays,
  weekStart,
}: {
  days: Date[]
  holidays: Set<string>
  weekStart: Date
}) {
  const [times, setTimes] = useState<ProjectTime[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const from = fmtDate(days[0])
  const to = fmtDate(days[6])

  useEffect(() => {
    loadTimes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function loadTimes() {
    setLoading(true)
    const { data } = await supabase
      .from('project_times')
      .select('*')
      .gte('date', from)
      .lte('date', to)
    setTimes((data as ProjectTime[]) ?? [])
    setLoading(false)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncStatus(null)
    try {
      const res = await fetch('/api/sync-projecttimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Unbekannter Fehler')
      setSyncStatus({ type: 'success', msg: `✓ ${json.count} Einträge aus ProSonata geladen.` })
      await loadTimes()
    } catch (err) {
      setSyncStatus({ type: 'error', msg: 'Sync fehlgeschlagen: ' + String(err) })
    }
    setSyncing(false)
  }

  // Mitarbeiter extrahieren und sortieren
  const employees = useMemo(() => {
    const map = new Map<string, { key: string; lastName: string; firstName: string }>()
    for (const t of times) {
      const key = t.employee_id || `${t.employee_last_name}_${t.employee_first_name}`
      if (key && !map.has(key)) {
        map.set(key, {
          key,
          lastName: t.employee_last_name ?? '',
          firstName: t.employee_first_name ?? '',
        })
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.lastName.localeCompare(b.lastName, 'de') ||
      a.firstName.localeCompare(b.firstName, 'de')
    )
  }, [times])

  // Buchungen nach Mitarbeiter-Key + Datum gruppieren
  const cellMap = useMemo(() => {
    // key: `${employeeKey}|${date}` → { isInternal, hasExternal, projectNames }
    const m = new Map<string, { hasExternal: boolean; hasInternal: boolean; projects: string[] }>()
    for (const t of times) {
      const empKey = t.employee_id || `${t.employee_last_name}_${t.employee_first_name}`
      if (!empKey) continue
      const cellKey = `${empKey}|${t.date}`
      const existing = m.get(cellKey) ?? { hasExternal: false, hasInternal: false, projects: [] }
      if (t.is_internal) existing.hasInternal = true
      else existing.hasExternal = true
      if (t.project_name && !existing.projects.includes(t.project_name)) {
        existing.projects.push(t.project_name)
      }
      m.set(cellKey, existing)
    }
    return m
  }, [times])

  return (
    <div>
      {/* Sync-Bereich */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="border border-border text-white px-5 py-2.5 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors disabled:opacity-40 whitespace-nowrap"
        >
          {syncing ? 'Synchronisiere…' : '↻ Aus ProSonata laden'}
        </button>
        <p className="text-muted font-opensans text-xs">
          Lädt die Arbeitszeiten der gewählten Woche aus ProSonata.
        </p>
      </div>

      {syncStatus && (
        <div className={`mb-5 px-4 py-3 border text-xs font-opensans ${
          syncStatus.type === 'success' ? 'border-green-400/30 text-green-400' : 'border-red-400/30 text-red-400'
        }`}>
          {syncStatus.msg}
        </div>
      )}

      {/* Legende */}
      <div className="flex items-center gap-6 mb-5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 border border-border" style={{ background: '#ffffff' }} />
          <span className="font-opensans text-xs text-muted">Externes Projekt</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 border border-border"
            style={{
              background: 'repeating-linear-gradient(-45deg,#fff,#fff 3px,#000 3px,#000 6px)',
            }}
          />
          <span className="font-opensans text-xs text-muted">Internes Projekt</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 border border-border bg-black" />
          <span className="font-opensans text-xs text-muted">Kein Projekt</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted text-sm font-opensans py-8">
          <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          Lade Daten…
        </div>
      ) : employees.length === 0 ? (
        <div className="border border-border p-8 text-center">
          <p className="font-opensans text-sm text-muted">
            Keine Daten für diese Woche. Bitte „Aus ProSonata laden" drücken.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse min-w-max w-full">
            <thead>
              <tr>
                {/* Namensspalte */}
                <th className="border border-border px-4 py-2 text-left font-raleway text-[10px] uppercase tracking-widest text-muted whitespace-nowrap min-w-[160px] bg-black sticky left-0 z-10">
                  Mitarbeiter
                </th>
                {days.map((day, i) => {
                  const dateStr = fmtDate(day)
                  const isHoliday = holidays.has(dateStr)
                  const isSun = isWeekend(day)
                  const isDimmed = isSun || isHoliday
                  return (
                    <th
                      key={dateStr}
                      className={`border border-border px-2 py-2 text-center font-raleway text-[10px] uppercase tracking-widest min-w-[70px] ${
                        isDimmed ? 'text-muted/50' : 'text-muted'
                      }`}
                    >
                      <div>{DAY_SHORT[i]}</div>
                      <div className="text-white/60 text-[9px] mt-0.5">{day.getDate()}.{pad(day.getMonth() + 1)}.</div>
                      {isHoliday && <div className="text-[8px] text-yellow-400/60 mt-0.5">Feiertag</div>}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.key}>
                  <td className="border border-border px-4 py-2 bg-black sticky left-0 z-10 whitespace-nowrap">
                    <span className="font-opensans text-xs text-white">
                      {emp.lastName}{emp.firstName ? `, ${emp.firstName}` : ''}
                    </span>
                  </td>
                  {days.map((day) => {
                    const dateStr = fmtDate(day)
                    const isHoliday = holidays.has(dateStr)
                    const isSun = isWeekend(day)
                    const cell = cellMap.get(`${emp.key}|${dateStr}`)

                    let cellStyle: React.CSSProperties = { background: '#000000' }
                    let title = 'Kein Projekt'

                    if (cell) {
                      if (cell.hasExternal) {
                        cellStyle = { background: '#ffffff' }
                      } else if (cell.hasInternal) {
                        cellStyle = {
                          background:
                            'repeating-linear-gradient(-45deg,#fff,#fff 3px,#000 3px,#000 6px)',
                        }
                      }
                      title = cell.projects.join(', ')
                    } else if (isSun || isHoliday) {
                      cellStyle = { background: '#0a0a0a' }
                      title = isHoliday ? 'Feiertag' : 'Wochenende'
                    }

                    return (
                      <td
                        key={dateStr}
                        className="border border-border"
                        title={title}
                        style={cellStyle}
                      >
                        <div className="w-full h-9" />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Meine Arbeitszeit (Team) ───────────────────────────────────

function MeineView({
  days,
  holidays,
  weekStart,
  profile,
}: {
  days: Date[]
  holidays: Set<string>
  weekStart: Date
  profile: { name: string | null } | null
}) {
  const [times, setTimes] = useState<ProjectTime[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const from = fmtDate(days[0])
  const to = fmtDate(days[6])

  // Name aus Profil für Matching (Format: "Vorname Nachname")
  const profileName = profile?.name?.toLowerCase().trim() ?? ''

  useEffect(() => {
    loadTimes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function loadTimes() {
    setLoading(true)
    const { data } = await supabase
      .from('project_times')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .order('date')
    const all = (data as ProjectTime[]) ?? []
    // Nur eigene Einträge zeigen – Matching per Name
    const own = profileName
      ? all.filter(t => {
          const fullName = `${t.employee_first_name ?? ''} ${t.employee_last_name ?? ''}`.toLowerCase().trim()
          const fullNameReversed = `${t.employee_last_name ?? ''} ${t.employee_first_name ?? ''}`.toLowerCase().trim()
          return fullName === profileName || fullNameReversed === profileName
        })
      : all
    setTimes(own)
    setLoading(false)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncStatus(null)
    try {
      const res = await fetch('/api/sync-projecttimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Unbekannter Fehler')
      setSyncStatus({ type: 'success', msg: `✓ Daten aktualisiert.` })
      await loadTimes()
    } catch (err) {
      setSyncStatus({ type: 'error', msg: 'Sync fehlgeschlagen: ' + String(err) })
    }
    setSyncing(false)
  }

  // Buchungen nach Tag gruppieren
  const byDate = useMemo(() => {
    const m = new Map<string, ProjectTime[]>()
    for (const t of times) {
      const arr = m.get(t.date) ?? []
      arr.push(t)
      m.set(t.date, arr)
    }
    return m
  }, [times])

  const totalHours = useMemo(
    () => times.reduce((s, t) => s + (t.hours ?? 0), 0),
    [times]
  )

  return (
    <div>
      {/* Sync */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="border border-border text-white px-5 py-2.5 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors disabled:opacity-40 whitespace-nowrap"
        >
          {syncing ? 'Synchronisiere…' : '↻ Aktualisieren'}
        </button>
        {totalHours > 0 && (
          <span className="font-opensans text-xs text-muted">
            Gesamt: <span className="text-white">{totalHours.toFixed(1)} h</span> diese Woche
          </span>
        )}
      </div>

      {syncStatus && (
        <div className={`mb-5 px-4 py-3 border text-xs font-opensans ${
          syncStatus.type === 'success' ? 'border-green-400/30 text-green-400' : 'border-red-400/30 text-red-400'
        }`}>
          {syncStatus.msg}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted text-sm font-opensans py-8">
          <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          Lade Daten…
        </div>
      ) : (
        <div className="space-y-2">
          {days.map((day, i) => {
            const dateStr = fmtDate(day)
            const isHoliday = holidays.has(dateStr)
            const isSun = isWeekend(day)
            const bookings = byDate.get(dateStr) ?? []
            const dayHours = bookings.reduce((s, t) => s + (t.hours ?? 0), 0)
            const isDimmed = isSun || isHoliday
            const isToday = fmtDate(new Date()) === dateStr

            return (
              <div
                key={dateStr}
                className={`border ${isToday ? 'border-white/40' : 'border-border'} ${isDimmed ? 'opacity-50' : ''}`}
              >
                {/* Tag-Header */}
                <div className={`flex items-center justify-between px-4 py-2 border-b border-border ${
                  isDimmed ? 'bg-black/60' : 'bg-black'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="font-raleway font-semibold text-[10px] uppercase tracking-widest text-muted">
                      {DAY_LONG[i]}
                    </span>
                    <span className="font-opensans text-xs text-white/60">
                      {day.getDate()}. {MONTH_NAMES[day.getMonth()]}
                    </span>
                    {isHoliday && (
                      <span className="font-opensans text-[9px] text-yellow-400/80 uppercase tracking-wider">
                        Feiertag
                      </span>
                    )}
                  </div>
                  {dayHours > 0 && (
                    <span className="font-raleway text-[10px] text-muted tracking-widest">
                      {dayHours.toFixed(1)} h
                    </span>
                  )}
                </div>

                {/* Buchungen */}
                {bookings.length === 0 ? (
                  <div className="px-4 py-3">
                    <span className="font-opensans text-xs text-muted/50">
                      {isSun || isHoliday ? '–' : 'Keine Buchung'}
                    </span>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {bookings.map(b => (
                      <div
                        key={b.id}
                        className="px-4 py-3 flex items-center gap-3"
                      >
                        {/* Farb-Indikator */}
                        <div
                          className="w-4 h-4 shrink-0 border border-border"
                          style={
                            b.is_internal
                              ? { background: 'repeating-linear-gradient(-45deg,#fff,#fff 2px,#000 2px,#000 5px)' }
                              : { background: '#ffffff' }
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-opensans text-sm text-white truncate">
                            {b.project_name || '(kein Projektname)'}
                          </p>
                          <p className="font-opensans text-[10px] text-muted">
                            {b.is_internal ? 'Intern' : 'Extern'}
                          </p>
                        </div>
                        {b.hours != null && b.hours > 0 && (
                          <span className="font-raleway text-xs text-muted whitespace-nowrap">
                            {b.hours.toFixed(1)} h
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && times.length === 0 && (
        <div className="mt-4 border border-border p-6 text-center">
          <p className="font-opensans text-sm text-muted">
            Keine Buchungen für diese Woche gefunden.{' '}
            {!profileName && 'Kein Name im Profil hinterlegt — Matching nicht möglich.'}
          </p>
        </div>
      )}
    </div>
  )
}
