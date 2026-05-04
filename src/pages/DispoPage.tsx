import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'

// ── Datum-Helpers ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

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

function isWeekend(d: Date) { const day = d.getDay(); return day === 0 || day === 6 }

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
  h.add(fmtD(addD(easter, 1)))
  h.add(fmtD(addD(easter, 39)))
  h.add(fmtD(addD(easter, 50)))
  h.add(fmtD(addD(easter, 60)))
  return h
}

// ── Typen ─────────────────────────────────────────────────────────────────────

interface DispoEintrag {
  id: string
  user_id: string
  projekt_id: string | null
  projekt_name: string | null
  is_internal: boolean
  datum_von: string
  datum_bis: string
  notiz: string | null
  created_by: string | null
  created_at: string
}

interface PersonProfile {
  id: string
  name: string | null
  rolle: string | null
  email: string | null
}

interface Projekt {
  id: string
  name: string
  typ: 'intern' | 'extern' | null
}

// ── Passwortschutz ────────────────────────────────────────────────────────────

const DISPO_KEY = 'dispo_unlocked'
const DISPO_PW = 'EarlyAccess'

function DispoPasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pw === DISPO_PW) {
      sessionStorage.setItem(DISPO_KEY, '1')
      onUnlock()
    } else {
      setError(true)
      setPw('')
    }
  }

  return (
    <div
      className="min-h-screen bg-black flex flex-col items-center justify-center px-4"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <ClockIcon className="w-10 h-10 text-white/30" />
          <h1 className="font-raleway font-semibold text-white text-lg uppercase tracking-widest mt-2">
            Dispo
          </h1>
          <p className="text-muted font-opensans text-xs text-center">
            Diese Funktion befindet sich im Early Access.<br />Bitte Zugangscode eingeben.
          </p>
        </div>
        <div className="border-t border-border mb-6" />
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
              Zugangscode
            </label>
            <input
              type="password"
              value={pw}
              onChange={e => { setPw(e.target.value); setError(false) }}
              autoFocus
              autoComplete="off"
              className="w-full bg-transparent border border-border text-white px-4 py-3.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
              placeholder="••••••••••"
            />
          </div>
          {error && (
            <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">
              Falscher Zugangscode.
            </p>
          )}
          <button
            type="submit"
            disabled={!pw}
            className="w-full bg-white text-black py-4 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40"
          >
            Zugang
          </button>
        </form>
        <div className="border-b border-border mt-6" />
      </div>
    </div>
  )
}

// ── Hauptseite ────────────────────────────────────────────────────────────────

export function DispoPage() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(DISPO_KEY) === '1')
  const { isAdminOrProjektleiter, profile } = useAuth()
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))

  if (!unlocked) return <DispoPasswordGate onUnlock={() => setUnlocked(true)} />

  const days = useMemo(() => getWeekDays(weekStart), [weekStart])
  const holidays = useMemo(() => {
    const years = new Set(days.map(d => d.getFullYear()))
    const all = new Set<string>()
    for (const y of years) getAustrianHolidays(y).forEach(h => all.add(h))
    return all
  }, [days])

  const weekLabel = useMemo(() => {
    const from = days[0], to = days[6]
    return `${from.getDate()}. ${MONTH_NAMES[from.getMonth()]} – ${to.getDate()}. ${MONTH_NAMES[to.getMonth()]} ${to.getFullYear()}`
  }, [days])

  const prevWeek = () => setWeekStart(p => { const d = new Date(p); d.setDate(d.getDate() - 7); return d })
  const nextWeek = () => setWeekStart(p => { const d = new Date(p); d.setDate(d.getDate() + 7); return d })
  const thisWeek = () => setWeekStart(getWeekStart(new Date()))

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
        {/* Seitentitel */}
        <div className="border-b border-border pb-6 mb-8 mt-6">
          <h1 className="font-raleway font-semibold text-white text-2xl sm:text-3xl uppercase tracking-widest">
            {isAdminOrProjektleiter ? 'Dispo' : (profile?.name ?? 'Dispo')}
          </h1>
          <p className="text-muted font-opensans text-sm mt-1">
            {isAdminOrProjektleiter
              ? 'Mitarbeiter zuteilen und Wochenübersicht verwalten'
              : 'Meine Wochenzuteilung'}
          </p>
        </div>

        {/* Wochennavigation */}
        <div className="flex items-center gap-3 mb-8 flex-wrap">
          <button
            onClick={prevWeek}
            className="border border-border text-white w-9 h-9 flex items-center justify-center hover:bg-white hover:text-black transition-colors text-sm"
          >
            ←
          </button>
          <span className="font-opensans text-sm text-white min-w-[220px] text-center">
            {weekLabel}
          </span>
          <button
            onClick={nextWeek}
            className="border border-border text-white w-9 h-9 flex items-center justify-center hover:bg-white hover:text-black transition-colors text-sm"
          >
            →
          </button>
          <button
            onClick={thisWeek}
            className="border border-border text-muted px-4 h-9 font-raleway text-[10px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
          >
            Heute
          </button>
        </div>

        {isAdminOrProjektleiter ? (
          <DispoMatrix days={days} holidays={holidays} />
        ) : (
          <MeineDispo days={days} holidays={holidays} userId={profile?.id ?? null} userName={profile?.name ?? null} />
        )}
      </main>
    </div>
  )
}

// ── Matrix-Ansicht (Admin / Projektleitung) ───────────────────────────────────

function DispoMatrix({ days, holidays }: { days: Date[]; holidays: Set<string> }) {
  const { user } = useAuth()
  const [persons, setPersons] = useState<PersonProfile[]>([])
  const [eintraege, setEintraege] = useState<DispoEintrag[]>([])
  const [projekte, setProjekte] = useState<Projekt[]>([])
  const [loading, setLoading] = useState(true)
  const [showNeu, setShowNeu] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<DispoEintrag | null>(null)
  const [selectedPersonName, setSelectedPersonName] = useState<string | null>(null)

  const from = fmtDate(days[0])
  const to = fmtDate(days[6])

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    loadEintraege()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function loadAll() {
    setLoading(true)
    const [pRes, prRes] = await Promise.all([
      supabase.from('profiles').select('id, name, rolle, email').order('name'),
      supabase.from('projects').select('id, name, typ').eq('status', 1).order('name'),
    ])
    setPersons((pRes.data as PersonProfile[]) ?? [])
    setProjekte((prRes.data as Projekt[]) ?? [])
    await loadEintraege()
    setLoading(false)
  }

  async function loadEintraege() {
    const { data } = await supabase
      .from('dispo_eintraege')
      .select('*')
      .lte('datum_von', to)
      .gte('datum_bis', from)
    setEintraege((data as DispoEintrag[]) ?? [])
  }

  // Map: userId → Set<dateStr> → DispoEintrag[]
  const cellMap = useMemo(() => {
    const m = new Map<string, DispoEintrag[]>()
    for (const e of eintraege) {
      const von = parseLocalDate(e.datum_von)
      const bis = parseLocalDate(e.datum_bis)
      for (const day of days) {
        if (day >= von && day <= bis) {
          const key = `${e.user_id}|${fmtDate(day)}`
          const arr = m.get(key) ?? []
          arr.push(e)
          m.set(key, arr)
        }
      }
    }
    return m
  }, [eintraege, days])

  async function deleteEntry(id: string) {
    await supabase.from('dispo_eintraege').delete().eq('id', id)
    await loadEintraege()
    setSelectedEntry(null)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted text-sm font-opensans py-12">
        <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
        Lade Dispo…
      </div>
    )
  }

  return (
    <div>
      {/* Neue Zuteilung Button */}
      <div className="mb-7">
        <button
          onClick={() => setShowNeu(true)}
          className="group inline-flex items-center gap-3 border border-border px-6 py-4 hover:border-white hover:bg-white transition-colors"
        >
          <ClockIcon className="w-5 h-5 text-white group-hover:text-black transition-colors shrink-0" />
          <span className="font-raleway font-semibold text-white group-hover:text-black text-xs uppercase tracking-widest transition-colors">
            Neue Zuteilung
          </span>
        </button>
      </div>

      {/* Legende */}
      <div className="flex items-center gap-5 mb-5 flex-wrap">
        <LegendItem color={{ background: '#ffffff' }} label="Externes Projekt" />
        <LegendItem color={{ background: 'repeating-linear-gradient(-45deg,#fff,#fff 3px,#000 3px,#000 6px)' }} label="Internes Projekt" />
        <LegendItem color={{ background: '#000000', outline: '1px solid #333' }} label="Kein Projekt" />
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto">
        <table className="border-collapse min-w-max w-full">
          <thead>
            <tr>
              <th className="border border-border px-4 py-2.5 text-left font-raleway text-[10px] uppercase tracking-widest text-muted whitespace-nowrap min-w-[160px] bg-black sticky left-0 z-10">
                Mitarbeiter
              </th>
              {days.map((day, i) => {
                const dateStr = fmtDate(day)
                const isHoliday = holidays.has(dateStr)
                const isSun = isWeekend(day)
                const isDimmed = isSun || isHoliday
                const isToday = fmtDate(new Date()) === dateStr
                return (
                  <th
                    key={dateStr}
                    className={`border px-2 py-2 text-center font-raleway text-[10px] uppercase tracking-widest min-w-[72px] ${
                      isToday ? 'border-white/40' : 'border-border'
                    } ${isDimmed ? 'text-muted/40' : 'text-muted'}`}
                  >
                    <div>{DAY_SHORT[i]}</div>
                    <div className="text-white/60 text-[9px] mt-0.5">
                      {day.getDate()}.{pad(day.getMonth() + 1)}.
                    </div>
                    {isHoliday && <div className="text-[8px] text-yellow-400/60 mt-0.5">Feiertag</div>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {persons.length === 0 ? (
              <tr>
                <td colSpan={8} className="border border-border px-4 py-8 text-center">
                  <span className="font-opensans text-sm text-muted">Keine Benutzer gefunden.</span>
                </td>
              </tr>
            ) : (
              persons.map(person => (
                <tr key={person.id}>
                  <td className="border border-border px-4 py-2 bg-black sticky left-0 z-10 whitespace-nowrap">
                    <span className="font-opensans text-xs text-white">{person.name ?? person.email ?? '–'}</span>
                  </td>
                  {days.map((day) => {
                    const dateStr = fmtDate(day)
                    const isHoliday = holidays.has(dateStr)
                    const isSun = isWeekend(day)
                    const cellEntries = cellMap.get(`${person.id}|${dateStr}`) ?? []

                    let cellStyle: React.CSSProperties
                    let title = 'Kein Projekt zugewiesen'

                    if (cellEntries.length > 0) {
                      const hasExternal = cellEntries.some(e => !e.is_internal)
                      const hasInternal = cellEntries.some(e => e.is_internal)
                      const names = [...new Set(cellEntries.map(e => e.projekt_name).filter(Boolean))].join(', ')
                      title = names || 'Projekt (ohne Name)'
                      if (hasExternal) {
                        cellStyle = { background: '#ffffff' }
                      } else if (hasInternal) {
                        cellStyle = { background: 'repeating-linear-gradient(-45deg,#fff,#fff 3px,#000 3px,#000 6px)' }
                      } else {
                        cellStyle = { background: '#ffffff' }
                      }
                    } else if (isSun || isHoliday) {
                      cellStyle = { background: '#0a0a0a' }
                      title = isHoliday ? 'Feiertag' : 'Wochenende'
                    } else {
                      cellStyle = { background: '#000000' }
                    }

                    return (
                      <td
                        key={dateStr}
                        className="border border-border cursor-pointer hover:opacity-80 transition-opacity"
                        title={title}
                        style={cellStyle}
                        onClick={() => {
                          if (cellEntries.length > 0) {
                            setSelectedEntry(cellEntries[0])
                            setSelectedPersonName(person.name ?? person.email ?? '–')
                          }
                        }}
                      >
                        <div className="w-full h-9" />
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Neue Zuteilung Modal */}
      {showNeu && (
        <NeuZuteilungModal
          persons={persons}
          projekte={projekte}
          defaultFrom={fmtDate(days[0])}
          defaultTo={fmtDate(days[4])}
          createdBy={user?.id ?? null}
          onClose={() => setShowNeu(false)}
          onSaved={() => { setShowNeu(false); loadEintraege() }}
        />
      )}

      {/* Eintrag-Detail Modal */}
      {selectedEntry && (
        <EntryDetailModal
          entry={selectedEntry}
          personName={selectedPersonName ?? '–'}
          onClose={() => setSelectedEntry(null)}
          onDelete={deleteEntry}
        />
      )}
    </div>
  )
}

// ── Neue Zuteilung Modal ──────────────────────────────────────────────────────

function NeuZuteilungModal({
  persons,
  projekte,
  defaultFrom,
  defaultTo,
  createdBy,
  onClose,
  onSaved,
}: {
  persons: PersonProfile[]
  projekte: Projekt[]
  defaultFrom: string
  defaultTo: string
  createdBy: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [datumVon, setDatumVon] = useState(defaultFrom)
  const [datumBis, setDatumBis] = useState(defaultTo)
  const [projektId, setProjektId] = useState<string>('')
  const [isInternal, setIsInternal] = useState(false)
  const [notiz, setNotiz] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filteredPersons = useMemo(
    () => persons.filter(p => {
      const name = (p.name ?? p.email ?? '').toLowerCase()
      return name.includes(search.toLowerCase())
    }),
    [persons, search]
  )

  // Wenn Projekt gewählt → is_internal automatisch setzen
  const handleProjektChange = (id: string) => {
    setProjektId(id)
    if (id) {
      const proj = projekte.find(p => p.id === id)
      if (proj) setIsInternal(proj.typ === 'intern')
    }
  }

  const togglePerson = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(filteredPersons.map(p => p.id)))
  const selectNone = () => setSelectedIds(new Set())

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (selectedIds.size === 0) { setError('Bitte mindestens eine Person auswählen.'); return }
    if (!datumVon || !datumBis) { setError('Bitte Von- und Bis-Datum angeben.'); return }
    if (datumVon > datumBis) { setError('Von-Datum muss vor dem Bis-Datum liegen.'); return }

    setSaving(true)
    setError(null)

    const selectedProj = projektId ? projekte.find(p => p.id === projektId) : null
    const rows = Array.from(selectedIds).map(userId => ({
      user_id: userId,
      projekt_id: projektId || null,
      projekt_name: selectedProj?.name ?? null,
      is_internal: isInternal,
      datum_von: datumVon,
      datum_bis: datumBis,
      notiz: notiz.trim() || null,
      created_by: createdBy,
    }))

    const { error: dbErr } = await supabase.from('dispo_eintraege').insert(rows)
    if (dbErr) {
      setError('Fehler beim Speichern: ' + dbErr.message)
      setSaving(false)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-black border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <ClockIcon className="w-5 h-5 text-white" />
            <h2 className="font-raleway font-semibold text-white text-sm uppercase tracking-widest">
              Neue Zuteilung
            </h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors text-lg leading-none">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
          {/* Zeitraum */}
          <div>
            <p className="font-raleway text-[10px] uppercase tracking-widest text-muted mb-3">
              Zeitraum
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted font-raleway mb-1.5">Von</label>
                <input
                  type="date"
                  value={datumVon}
                  onChange={e => setDatumVon(e.target.value)}
                  required
                  className="w-full bg-transparent border border-border text-white px-3 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted font-raleway mb-1.5">Bis</label>
                <input
                  type="date"
                  value={datumBis}
                  onChange={e => setDatumBis(e.target.value)}
                  required
                  min={datumVon}
                  className="w-full bg-transparent border border-border text-white px-3 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Personen */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="font-raleway text-[10px] uppercase tracking-widest text-muted">
                Personen <span className="text-white">{selectedIds.size > 0 ? `(${selectedIds.size} ausgewählt)` : ''}</span>
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={selectAll} className="font-raleway text-[9px] uppercase tracking-widest text-muted hover:text-white transition-colors">
                  Alle
                </button>
                <button type="button" onClick={selectNone} className="font-raleway text-[9px] uppercase tracking-widest text-muted hover:text-white transition-colors">
                  Keine
                </button>
              </div>
            </div>
            <input
              type="text"
              placeholder="Suchen…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-transparent border border-border text-white px-3 py-2 font-opensans text-xs focus:border-white outline-none transition-colors placeholder-muted mb-2"
            />
            <div className="border border-border divide-y divide-border max-h-48 overflow-y-auto">
              {filteredPersons.map(p => (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    selectedIds.has(p.id) ? 'bg-white/5' : 'hover:bg-white/3'
                  }`}
                >
                  <div
                    className={`w-4 h-4 border shrink-0 flex items-center justify-center transition-colors ${
                      selectedIds.has(p.id) ? 'bg-white border-white' : 'border-border'
                    }`}
                  >
                    {selectedIds.has(p.id) && (
                      <span className="text-black text-[10px] leading-none font-bold">✓</span>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => togglePerson(p.id)}
                    className="sr-only"
                  />
                  <span className="font-opensans text-xs text-white">{p.name ?? p.email ?? '–'}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Projekt */}
          <div>
            <label className="block font-raleway text-[10px] uppercase tracking-widest text-muted mb-1.5">
              Projekt (optional)
            </label>
            <select
              value={projektId}
              onChange={e => handleProjektChange(e.target.value)}
              className="w-full bg-black border border-border text-white px-3 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors"
            >
              <option value="">– Kein Projekt –</option>
              {projekte.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Intern / Extern */}
          <div>
            <p className="font-raleway text-[10px] uppercase tracking-widest text-muted mb-2">Art</p>
            <div className="flex gap-3">
              {[
                { label: 'Extern', val: false },
                { label: 'Intern', val: true },
              ].map(opt => (
                <button
                  key={String(opt.val)}
                  type="button"
                  onClick={() => setIsInternal(opt.val)}
                  className={`flex-1 py-2.5 border font-raleway text-[10px] uppercase tracking-widest transition-colors ${
                    isInternal === opt.val
                      ? 'bg-white text-black border-white'
                      : 'border-border text-muted hover:border-white hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notiz */}
          <div>
            <label className="block font-raleway text-[10px] uppercase tracking-widest text-muted mb-1.5">
              Notiz (optional)
            </label>
            <textarea
              value={notiz}
              onChange={e => setNotiz(e.target.value)}
              rows={2}
              className="w-full bg-transparent border border-border text-white px-3 py-2 font-opensans text-sm focus:border-white outline-none transition-colors resize-none placeholder-muted"
              placeholder="z. B. Baustelle XY, Urlaubsvertretung…"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || selectedIds.size === 0}
              className="flex-1 bg-white text-black py-3 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40"
            >
              {saving ? 'Wird gespeichert…' : `${selectedIds.size > 0 ? selectedIds.size : ''} ${selectedIds.size === 1 ? 'Person' : 'Personen'} zuteilen`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border border-border text-white px-5 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Eintrag Detail Modal ──────────────────────────────────────────────────────

function EntryDetailModal({
  entry,
  personName,
  onClose,
  onDelete,
}: {
  entry: DispoEintrag
  personName: string
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const vonDate = parseLocalDate(entry.datum_von)
  const bisDate = parseLocalDate(entry.datum_bis)

  const fmtDisplay = (d: Date) =>
    `${d.getDate()}. ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-black border border-border w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2 className="font-raleway font-semibold text-white text-sm uppercase tracking-widest">
            Zuteilung
          </h2>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors text-lg leading-none">
            ✕
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <InfoRow label="Person" value={personName} />
          <InfoRow label="Zeitraum" value={`${fmtDisplay(vonDate)} – ${fmtDisplay(bisDate)}`} />
          <InfoRow label="Projekt" value={entry.projekt_name ?? '–'} />
          <InfoRow label="Art" value={entry.is_internal ? 'Intern' : 'Extern'} />
          {entry.notiz && <InfoRow label="Notiz" value={entry.notiz} />}
        </div>
        <div className="px-6 pb-6">
          {confirming ? (
            <div className="space-y-2">
              <p className="font-opensans text-xs text-muted mb-3">Zuteilung wirklich löschen?</p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setDeleting(true)
                    await onDelete(entry.id)
                    setDeleting(false)
                  }}
                  disabled={deleting}
                  className="flex-1 border border-red-400/50 text-red-400 py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:bg-red-400 hover:text-black transition-colors disabled:opacity-40"
                >
                  {deleting ? 'Löschen…' : 'Ja, löschen'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex-1 border border-border text-muted py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:text-white transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="w-full border border-border text-muted py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:border-red-400/50 hover:text-red-400 transition-colors"
            >
              Zuteilung löschen
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Meine Dispo (Mitarbeiter) ─────────────────────────────────────────────────

function MeineDispo({
  days,
  holidays,
  userId,
  userName,
}: {
  days: Date[]
  holidays: Set<string>
  userId: string | null
  userName: string | null
}) {
  const [eintraege, setEintraege] = useState<DispoEintrag[]>([])
  const [loading, setLoading] = useState(true)

  const from = fmtDate(days[0])
  const to = fmtDate(days[6])

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    loadEintraege()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, userId])

  async function loadEintraege() {
    setLoading(true)
    const { data } = await supabase
      .from('dispo_eintraege')
      .select('*')
      .eq('user_id', userId)
      .lte('datum_von', to)
      .gte('datum_bis', from)
    setEintraege((data as DispoEintrag[]) ?? [])
    setLoading(false)
  }

  // Für jeden Tag: welche Einträge sind aktiv?
  const byDate = useMemo(() => {
    const m = new Map<string, DispoEintrag[]>()
    for (const e of eintraege) {
      const von = parseLocalDate(e.datum_von)
      const bis = parseLocalDate(e.datum_bis)
      for (const day of days) {
        if (day >= von && day <= bis) {
          const key = fmtDate(day)
          const arr = m.get(key) ?? []
          arr.push(e)
          m.set(key, arr)
        }
      }
    }
    return m
  }, [eintraege, days])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted text-sm font-opensans py-12">
        <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
        Lade Dispo…
      </div>
    )
  }

  if (!userId) {
    return (
      <div className="border border-border p-8 text-center">
        <p className="font-opensans text-sm text-muted">Kein Benutzer-Profil gefunden.</p>
      </div>
    )
  }

  const assignedDays = days.filter(d => (byDate.get(fmtDate(d)) ?? []).length > 0).length

  return (
    <div>
      {/* Persönliche Wochenzusammenfassung */}
      {userName && (
        <div className="border border-border px-5 py-4 mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="font-raleway font-semibold text-white text-sm uppercase tracking-widest">
              {userName}
            </p>
            <p className="font-opensans text-xs text-muted mt-0.5">
              {assignedDays === 0
                ? 'Diese Woche noch keine Zuteilung'
                : `${assignedDays} ${assignedDays === 1 ? 'Tag' : 'Tage'} eingeteilt`}
            </p>
          </div>
          <ClockIcon className="w-6 h-6 text-white/20 shrink-0" />
        </div>
      )}

      <div className="space-y-2">
      {days.map((day, i) => {
        const dateStr = fmtDate(day)
        const isHoliday = holidays.has(dateStr)
        const isSun = isWeekend(day)
        const bookings = byDate.get(dateStr) ?? []
        const isDimmed = isSun || isHoliday
        const isToday = fmtDate(new Date()) === dateStr

        return (
          <div
            key={dateStr}
            className={`border ${isToday ? 'border-white/40' : 'border-border'} ${isDimmed ? 'opacity-40' : ''}`}
          >
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-black">
              <span className={`font-raleway font-semibold text-[10px] uppercase tracking-widest ${isToday ? 'text-white' : 'text-muted'}`}>
                {DAY_LONG[i]}
              </span>
              <span className="font-opensans text-xs text-white/60">
                {day.getDate()}. {MONTH_NAMES[day.getMonth()]}
              </span>
              {isToday && (
                <span className="font-raleway text-[9px] uppercase tracking-widest text-white/40 border border-white/20 px-1.5 py-0.5">
                  Heute
                </span>
              )}
              {isHoliday && (
                <span className="font-opensans text-[9px] text-yellow-400/80 uppercase tracking-wider">
                  Feiertag
                </span>
              )}
            </div>
            {bookings.length === 0 ? (
              <div className="px-4 py-3">
                <span className="font-opensans text-xs text-muted/50">
                  {isDimmed ? '–' : 'Kein Projekt zugeteilt'}
                </span>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {bookings.map(b => (
                  <div key={b.id} className="px-4 py-3 flex items-center gap-3">
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
                        {b.projekt_name ?? '(kein Projektname)'}
                      </p>
                      <p className="font-opensans text-[10px] text-muted">
                        {b.is_internal ? 'Intern' : 'Extern'}
                        {b.notiz ? ` · ${b.notiz}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}

// ── Hilfskomponenten ──────────────────────────────────────────────────────────

function LegendItem({ color, label }: { color: React.CSSProperties; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-5 h-5 border border-border shrink-0" style={color} />
      <span className="font-opensans text-xs text-muted">{label}</span>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-raleway text-[10px] uppercase tracking-widest text-muted mb-0.5">{label}</p>
      <p className="font-opensans text-sm text-white">{value}</p>
    </div>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
