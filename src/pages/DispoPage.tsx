import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'

// ── Datum-Helpers ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
]
const MONTH_LONG = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function nextDay(s: string): string { const d = parseLocalDate(s); d.setDate(d.getDate() + 1); return fmtDate(d) }
function prevDay(s: string): string { const d = parseLocalDate(s); d.setDate(d.getDate() - 1); return fmtDate(d) }

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}
function getWeekDays(ws: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i); return d
  })
}

// ── Typen ─────────────────────────────────────────────────────────────────────

interface DispoEintrag {
  id: string; user_id: string; projekt_id: string | null; projekt_name: string | null
  is_internal: boolean; datum_von: string; datum_bis: string; notiz: string | null
  created_by: string | null; created_at: string
}
interface PersonProfile { id: string; name: string | null; rolle: string | null }
interface Projekt { id: string; name: string; typ: 'intern' | 'extern' | null; status: string; created_at: string }

const STRIPE = 'repeating-linear-gradient(-45deg,#fff,#fff 3px,#000 3px,#000 6px)'
// Namensspalte + 7 gleiche Tages-Spalten
const GRID_COLS = '72px repeat(7, 1fr)'

// ── Passwortschutz (mit Header) ───────────────────────────────────────────────

const DISPO_KEY = 'dispo_unlocked'
const DISPO_PW = 'EarlyAccess'

function DispoPasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pw === DISPO_PW) { sessionStorage.setItem(DISPO_KEY, '1'); onUnlock() }
    else { setError(true); setPw(''); setShake(true); setTimeout(() => setShake(false), 400) }
  }

  return (
    <div className="min-h-screen bg-black">
      <Header />
      <div
        className="flex flex-col items-center justify-center px-4"
        style={{
          minHeight: '100svh',
          paddingTop: 'calc(env(safe-area-inset-top) + 56px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 3rem)',
        }}
      >
        <div className="w-full max-w-xs">
          {/* Icon + Titel */}
          <div className="mb-10 flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 border border-border flex items-center justify-center">
                <LockIcon className="w-6 h-6 text-white" />
              </div>
              <div className="absolute -inset-2 border border-border/20 pointer-events-none" />
            </div>
            <div className="text-center">
              <h1 className="font-raleway font-semibold text-white text-base uppercase tracking-[0.25em]">Dispo</h1>
              <p className="text-muted font-opensans text-[11px] mt-1.5 tracking-wide">Early Access</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div style={{ animation: shake ? 'shake 0.4s ease' : 'none' }}>
              <input
                type="password" value={pw}
                onChange={e => { setPw(e.target.value); setError(false) }}
                autoFocus autoComplete="off" placeholder="Zugangscode"
                className={`w-full bg-transparent border text-white px-4 py-4 font-raleway text-sm uppercase tracking-[0.25em] outline-none transition-colors placeholder-muted/40 ${error ? 'border-red-400/60' : 'border-border focus:border-white/60'}`}
              />
            </div>
            {error && (
              <p className="text-red-400/80 text-[10px] font-opensans text-center tracking-widest uppercase">
                Falscher Zugangscode
              </p>
            )}
            <button type="submit" disabled={!pw}
              className="w-full bg-white text-black py-4 font-raleway font-semibold text-[11px] uppercase tracking-[0.25em] hover:bg-white/90 transition-colors disabled:opacity-30">
              Zugang
            </button>
          </form>
        </div>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`}</style>
    </div>
  )
}

// ── Hauptseite ────────────────────────────────────────────────────────────────

export function DispoPage() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(DISPO_KEY) === '1')
  const { isAdminOrProjektleiter, profile, loading: authLoading, profileReady } = useAuth()
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))

  const days = useMemo(() => getWeekDays(weekStart), [weekStart])

  const weekLabel = useMemo(() => {
    const f = days[0], t = days[6]
    // Kurzes Format wenn gleicher Monat: "5.–11. Mai 2026"
    if (f.getMonth() === t.getMonth()) {
      return `${f.getDate()}.–${t.getDate()}. ${MONTH_LONG[f.getMonth()]} ${f.getFullYear()}`
    }
    // Verschiedene Monate: "29. Apr – 5. Mai 2026"
    return `${f.getDate()}. ${MONTH_NAMES[f.getMonth()]} – ${t.getDate()}. ${MONTH_NAMES[t.getMonth()]} ${t.getFullYear()}`
  }, [days])

  const prevWeek = () => setWeekStart(p => { const d = new Date(p); d.setDate(d.getDate() - 7); return d })
  const nextWeek = () => setWeekStart(p => { const d = new Date(p); d.setDate(d.getDate() + 7); return d })

  if (!unlocked) return <DispoPasswordGate onUnlock={() => setUnlocked(true)} />

  return (
    <div className="bg-black flex flex-col overflow-hidden" style={{ height: '100svh' }}>
      <Header />
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 56px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Name + Projektzuteilung – nur Mitarbeiter, erst nach DB-Bestätigung zeigen */}
        {profileReady && !isAdminOrProjektleiter && (
          <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
            <p className="text-muted/60 font-raleway text-[9px] uppercase tracking-[0.25em] mb-1">Projektzuteilung</p>
            <h1 className="font-raleway font-semibold text-white text-2xl uppercase tracking-widest leading-none">
              {profile?.name ?? '–'}
            </h1>
          </div>
        )}

        {/* Wochennavigation */}
        <div className="flex items-center justify-center gap-3 py-2.5 border-b border-border shrink-0 px-4">
          <button onClick={prevWeek}
            className="border border-border/60 text-white/70 w-8 h-8 flex items-center justify-center hover:bg-white hover:text-black hover:border-white transition-colors shrink-0">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="font-raleway text-[11px] uppercase tracking-[0.2em] text-white text-center flex-1 leading-tight">
            {weekLabel}
          </span>
          <button onClick={nextWeek}
            className="border border-border/60 text-white/70 w-8 h-8 flex items-center justify-center hover:bg-white hover:text-black hover:border-white transition-colors shrink-0">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Hauptinhalt – warte auf DB-Bestätigung damit Admin nie kurz die Mitarbeiter-View sieht */}
        <div className="flex-1 overflow-hidden">
          {authLoading || !profileReady ? (
            <DispoLoadingSkeleton />
          ) : isAdminOrProjektleiter ? (
            <DispoMatrix days={days} />
          ) : (
            <MeineDispo days={days} userId={profile?.id ?? null} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Auth-Loading Skeleton ─────────────────────────────────────────────────────

function DispoLoadingSkeleton() {
  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-7 border-b border-border shrink-0">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i}
            className="border-r border-border last:border-r-0 py-3 animate-pulse"
            style={{ background: '#0a0a0a', animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i}
            className="border-r border-border last:border-r-0 animate-pulse"
            style={{ background: '#060606', animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

// ── Matrix-Ansicht (Admin / Projektleitung) ───────────────────────────────────

function DispoMatrix({ days }: { days: Date[] }) {
  const { user } = useAuth()
  const [persons, setPersons] = useState<PersonProfile[]>([])
  const [eintraege, setEintraege] = useState<DispoEintrag[]>([])
  const [projekte, setProjekte] = useState<Projekt[]>([])
  const [loading, setLoading] = useState(true)
  const [showNeu, setShowNeu] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<DispoEintrag | null>(null)
  const [selectedPersonName, setSelectedPersonName] = useState<string | null>(null)
  const [tapDate, setTapDate] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const didMountRef = useRef(false)

  const from = fmtDate(days[0]), to = fmtDate(days[6])
  const todayStr = fmtDate(new Date())

  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Skip the initial run — loadAll already fetches eintraege on mount
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    loadEintraege()
  }, [from, to, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: refresh when any other client changes dispo_eintraege
  useEffect(() => {
    const channel = supabase
      .channel('dispo-matrix')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispo_eintraege' }, () => {
        setRefreshKey(k => k + 1)
      })
      .subscribe()
    // Also refresh when the tab regains focus (e.g. user switches back from another device)
    const onFocus = () => setRefreshKey(k => k + 1)
    window.addEventListener('focus', onFocus)
    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true)
    const [pRes, prRes] = await Promise.all([
      supabase.from('profiles').select('id, name, rolle').order('name'),
      supabase.from('projects').select('id, name, typ, status, created_at').eq('status', 'aktiv').order('name'),
    ])
    setPersons((pRes.data as PersonProfile[]) ?? [])
    setProjekte((prRes.data as Projekt[]) ?? [])
    await loadEintraege()
    setLoading(false)
  }

  async function loadEintraege() {
    const { data } = await supabase
      .from('dispo_eintraege').select('*')
      .lte('datum_von', to).gte('datum_bis', from)
    const rows = (data as DispoEintrag[]) ?? []
    setEintraege(rows)
    // If the open detail modal no longer exists in the fresh data, close it
    setSelectedEntry(prev => prev && rows.some(r => r.id === prev.id) ? prev : null)
  }

  const cellMap = useMemo(() => {
    const m = new Map<string, DispoEintrag[]>()
    for (const e of eintraege) {
      const von = parseLocalDate(e.datum_von), bis = parseLocalDate(e.datum_bis)
      for (const day of days) {
        if (day >= von && day <= bis) {
          const key = `${e.user_id}|${fmtDate(day)}`
          const arr = m.get(key) ?? []; arr.push(e); m.set(key, arr)
        }
      }
    }
    return m
  }, [eintraege, days])

  async function deleteEntry(id: string) {
    const { error } = await supabase.from('dispo_eintraege').delete().eq('id', id)
    if (error) throw new Error(error.message)
    setRefreshKey(k => k + 1)
    setSelectedEntry(null)
  }

  async function deleteSingleDay(entry: DispoEintrag, day: string) {
    if (entry.datum_von === entry.datum_bis || day === entry.datum_von && day === entry.datum_bis) {
      return deleteEntry(entry.id)
    }
    if (day === entry.datum_von) {
      const { error } = await supabase.from('dispo_eintraege').update({ datum_von: nextDay(day) }).eq('id', entry.id)
      if (error) throw new Error(error.message)
      return
    }
    if (day === entry.datum_bis) {
      const { error } = await supabase.from('dispo_eintraege').update({ datum_bis: prevDay(day) }).eq('id', entry.id)
      if (error) throw new Error(error.message)
      return
    }
    // Mittlerer Tag: Original kürzen + zweiten Eintrag erstellen
    const { error: e1 } = await supabase.from('dispo_eintraege').update({ datum_bis: prevDay(day) }).eq('id', entry.id)
    if (e1) throw new Error(e1.message)
    const { error: e2 } = await supabase.from('dispo_eintraege').insert({
      user_id: entry.user_id, projekt_id: entry.projekt_id,
      projekt_name: entry.projekt_name, is_internal: entry.is_internal,
      datum_von: nextDay(day), datum_bis: entry.datum_bis, created_by: entry.created_by,
    })
    if (e2) throw new Error(e2.message)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Aktionsleiste */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0 gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <LegendItem color={{ background: '#fff' }} label="Extern" />
          <LegendItem color={{ background: STRIPE }} label="Intern" />
          <LegendItem color={{ background: '#000', outline: '1px solid #2a2a2a' }} label="Frei" />
        </div>
        <button
          onClick={() => setShowNeu(true)}
          className="bg-white text-black px-4 py-2 hover:bg-white/90 transition-colors shrink-0 font-raleway font-semibold text-[10px] uppercase tracking-widest whitespace-nowrap"
        >
          + Zuteilen
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex-1 flex flex-col">
          {/* Skeleton Header */}
          <div className="grid border-b border-border shrink-0" style={{ gridTemplateColumns: GRID_COLS }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border-r border-border last:border-r-0 py-3 animate-pulse bg-white/[0.02]" />
            ))}
          </div>
          {/* Skeleton Rows */}
          <div className="flex-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="grid border-b border-border" style={{ gridTemplateColumns: GRID_COLS }}>
                {Array.from({ length: 8 }).map((_, j) => (
                  <div key={j}
                    className="border-r border-border last:border-r-0 h-10 animate-pulse"
                    style={{ background: i % 2 === 0 ? '#0d0d0d' : '#080808', animationDelay: `${j * 60}ms` }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Sticky Header */}
          <div className="grid sticky top-0 z-10 bg-black border-b border-border" style={{ gridTemplateColumns: GRID_COLS }}>
            <div className="border-r border-border px-2 py-3" />
            {days.map((day, i) => {
              const dateStr = fmtDate(day)
              const isToday = dateStr === todayStr
              return (
                <div key={dateStr}
                  className="border-r border-border last:border-r-0 text-center py-2.5"
                  style={{ background: isToday ? '#ffffff' : 'transparent' }}
                >
                  <p className={`font-raleway text-[9px] uppercase tracking-widest ${isToday ? 'text-black font-semibold' : 'text-muted'}`}>
                    {DAY_SHORT[i]}
                  </p>
                  <p className={`font-opensans text-[12px] font-semibold mt-0.5 ${isToday ? 'text-black' : 'text-white/80'}`}>
                    {day.getDate()}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Personen */}
          {persons.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="font-opensans text-sm text-muted">Keine Benutzer vorhanden.</p>
            </div>
          ) : persons.map((person, idx) => (
            <div key={person.id}
              className="grid border-b border-border last:border-b-0"
              style={{ gridTemplateColumns: GRID_COLS, background: idx % 2 === 0 ? '#000' : '#060606' }}
            >
              <div className="border-r border-border px-2 py-2 overflow-hidden flex flex-col justify-center">
                <span className="font-opensans text-[10px] text-white block truncate leading-tight">
                  {(person.name ?? '–').split(' ')[0]}
                </span>
                {person.name && person.name.includes(' ') && (
                  <span className="font-opensans text-[9px] text-muted/60 block truncate leading-tight">
                    {person.name.split(' ').slice(1).join(' ')}
                  </span>
                )}
              </div>
              {days.map(day => {
                const dateStr = fmtDate(day)
                const isToday = dateStr === todayStr
                const cellEntries = cellMap.get(`${person.id}|${dateStr}`) ?? []
                const hasExt = cellEntries.some(e => !e.is_internal)
                const hasInt = cellEntries.some(e => e.is_internal)
                const title = cellEntries.length > 0
                  ? [...new Set(cellEntries.map(e => e.projekt_name).filter(Boolean))].join(', ') || 'Projekt'
                  : ''
                let bg: string
                if (hasExt) bg = '#ffffff'
                else if (hasInt) bg = STRIPE
                else bg = isToday ? '#111' : 'transparent'

                return (
                  <div key={dateStr}
                    className="border-r border-border last:border-r-0 h-10 transition-opacity hover:opacity-70 relative"
                    style={{ background: bg, cursor: cellEntries.length > 0 ? 'pointer' : 'default' }}
                    title={title}
                    onClick={() => {
                      if (cellEntries.length > 0) {
                        setSelectedEntry(cellEntries[0])
                        setSelectedPersonName(person.name ?? '–')
                        setTapDate(dateStr)
                      }
                    }}
                  >
                    {isToday && !hasExt && !hasInt && (
                      <div className="absolute inset-x-0 top-0 h-px bg-white/20" />
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {showNeu && (
        <NeuZuteilungModal
          persons={persons} projekte={projekte}
          defaultFrom={fmtDate(days[0])} defaultTo={fmtDate(days[4])}
          createdBy={user?.id ?? null}
          onClose={() => setShowNeu(false)}
          onSaved={() => { setShowNeu(false); loadEintraege() }}
        />
      )}
      {selectedEntry && (
        <EntryDetailModal
          entry={selectedEntry} personName={selectedPersonName ?? '–'} tapDate={tapDate}
          onClose={() => setSelectedEntry(null)} onDelete={deleteEntry}
          onDeleteDay={async (entry, day) => {
            await deleteSingleDay(entry, day)
            setRefreshKey(k => k + 1)
            setSelectedEntry(null)
          }}
        />
      )}
    </div>
  )
}


// ── Fuzzy-Suche Helpers ───────────────────────────────────────────────────────

function fuzzyMatch(text: string, q: string): boolean {
  if (!q) return true
  const t = text.toLowerCase(); const qLow = q.toLowerCase()
  if (t.includes(qLow)) return true
  let qi = 0
  for (let i = 0; i < t.length && qi < qLow.length; i++) { if (t[i] === qLow[qi]) qi++ }
  return qi === qLow.length
}
function fuzzyScore(text: string, q: string): number {
  const t = text.toLowerCase(); const qLow = q.toLowerCase()
  if (t.startsWith(qLow)) return 3
  if (t.includes(qLow)) return 2
  return 1
}

// ── Neue Zuteilung Modal ──────────────────────────────────────────────────────

function NeuZuteilungModal({ persons, projekte, defaultFrom, defaultTo, createdBy, onClose, onSaved }: {
  persons: PersonProfile[]; projekte: Projekt[]
  defaultFrom: string; defaultTo: string; createdBy: string | null
  onClose: () => void; onSaved: () => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [datumVon, setDatumVon] = useState(defaultFrom)
  const [datumBis, setDatumBis] = useState(defaultTo)
  const [projektId, setProjektId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [projektSearch, setProjektSearch] = useState('')
  const [projektSort, setProjektSort] = useState<'name' | 'datum'>('name')
  const [typFilter, setTypFilter] = useState<'all' | 'intern' | 'extern'>('all')
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id) }, [])


  const filteredPersons = useMemo(
    () => persons
      .filter(p => fuzzyMatch(p.name ?? '', search))
      .sort((a, b) => search ? fuzzyScore(b.name ?? '', search) - fuzzyScore(a.name ?? '', search) : 0),
    [persons, search]
  )

  const sortedProjekte = useMemo(() => {
    const filtered = projekte
      .filter(p => typFilter === 'all' || p.typ === typFilter)
      .filter(p => fuzzyMatch(p.name, projektSearch))
    const sorted = projektSort === 'datum'
      ? [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at))
      : [...filtered].sort((a, b) => {
          if (projektSearch) return fuzzyScore(b.name, projektSearch) - fuzzyScore(a.name, projektSearch)
          return a.name.localeCompare(b.name, 'de')
        })
    // Gewähltes Projekt immer oben – auch wenn es nicht zur Suche passt
    if (projektId) {
      const idx = sorted.findIndex(p => p.id === projektId)
      if (idx > 0) sorted.unshift(...sorted.splice(idx, 1))
      else if (idx === -1) {
        const sel = projekte.find(p => p.id === projektId)
        if (sel) sorted.unshift(sel)
      }
    }
    return sorted
  }, [projekte, projektSearch, projektSort, projektId, typFilter])

  const selectedProjekt = projekte.find(p => p.id === projektId) ?? null

  const handleProjektSelect = (id: string) => {
    setProjektId(prev => prev === id ? '' : id)
  }
  const togglePerson = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const selectAll = () => setSelectedIds(new Set(filteredPersons.map(p => p.id)))
  const selectNone = () => setSelectedIds(new Set())

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return // prevent double-submit
    if (selectedIds.size === 0) { setError('Bitte mindestens eine Person auswählen.'); return }
    if (datumVon > datumBis) { setError('Von-Datum muss vor dem Bis-Datum liegen.'); return }
    setSaving(true); setError(null)
    const proj = selectedProjekt
    const isInternal = proj?.typ === 'intern'
    const { error: dbErr } = await supabase.from('dispo_eintraege').insert(
      Array.from(selectedIds).map(userId => ({
        user_id: userId, projekt_id: projektId || null,
        projekt_name: proj?.name ?? null, is_internal: isInternal,
        datum_von: datumVon, datum_bis: datumBis,
        notiz: null, created_by: createdBy,
      }))
    )
    if (dbErr) {
      const msg = dbErr.code === '23514' ? 'Zeitraum ungültig (Von muss vor Bis liegen).'
        : dbErr.code === '42501' ? 'Keine Berechtigung zum Speichern.'
        : 'Fehler beim Speichern. Bitte nochmal versuchen.'
      setError(msg)
      setSaving(false)
      return
    }
    onSaved()
  }

  const label = selectedIds.size === 0
    ? 'Zuteilen'
    : selectedIds.size === 1 ? '1 Person zuteilen' : `${selectedIds.size} Personen zuteilen`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4"
      style={{ background: mounted ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)', backdropFilter: 'blur(4px)', transition: 'background 250ms' }}
      onClick={saving ? undefined : onClose}
    >
      <div
        className="bg-black border border-border w-full sm:max-w-lg max-h-[92svh] overflow-y-auto"
        style={{ transform: mounted ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 300ms cubic-bezier(0.32,0.72,0,1)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-center px-6 py-5 border-b border-border">
          <h2 className="font-raleway font-semibold text-white text-xs uppercase tracking-widest">
            Neue Zuteilung
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Zeitraum */}
          <div>
            <p className="font-raleway text-[10px] uppercase tracking-widest text-muted mb-2">Zeitraum</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <label className="block text-[10px] uppercase tracking-widest text-muted/60 font-raleway mb-1">Von</label>
                <input type="date" value={datumVon} required onChange={e => {
                    const v = e.target.value
                    setDatumVon(v)
                    if (datumBis < v) setDatumBis(v)
                  }}
                  className="w-full min-w-0 bg-transparent border border-border text-white px-2 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors" />
              </div>
              <div className="min-w-0">
                <label className="block text-[10px] uppercase tracking-widest text-muted/60 font-raleway mb-1">Bis</label>
                <input type="date" value={datumBis} required min={datumVon} onChange={e => setDatumBis(e.target.value)}
                  className="w-full min-w-0 bg-transparent border border-border text-white px-2 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors" />
              </div>
            </div>
          </div>

          {/* Personen */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="font-raleway text-[10px] uppercase tracking-widest text-muted">
                Personen
                {selectedIds.size > 0 && (
                  <span className="text-white ml-1.5">({selectedIds.size})</span>
                )}
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={selectAll}
                  className="font-raleway text-[9px] uppercase tracking-widest text-muted hover:text-white transition-colors">Alle</button>
                <button type="button" onClick={selectNone}
                  className="font-raleway text-[9px] uppercase tracking-widest text-muted hover:text-white transition-colors">Keine</button>
              </div>
            </div>
            <input type="text" placeholder="Suchen…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-transparent border border-border text-white px-3 py-2 font-opensans text-xs focus:border-white outline-none transition-colors placeholder-muted mb-2" />
            <div className="border border-border divide-y divide-border/40 max-h-44 overflow-y-auto">
              {filteredPersons.length === 0 ? (
                <div className="px-4 py-3">
                  <span className="font-opensans text-xs text-muted">Keine Personen gefunden.</span>
                </div>
              ) : filteredPersons.map(p => (
                <label key={p.id}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors select-none ${selectedIds.has(p.id) ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
                >
                  <div className={`w-4 h-4 border shrink-0 flex items-center justify-center transition-all ${selectedIds.has(p.id) ? 'bg-white border-white' : 'border-border'}`}>
                    {selectedIds.has(p.id) && <span className="text-black text-[10px] leading-none">✓</span>}
                  </div>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => togglePerson(p.id)} className="sr-only" />
                  <span className="font-opensans text-xs text-white leading-tight">{p.name ?? '–'}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Projekt */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="font-raleway text-[10px] uppercase tracking-widest text-muted">Projekt</p>
              <div className="flex gap-2">
                {(['all', 'extern', 'intern'] as const).map(f => (
                  <button key={f} type="button" onClick={() => setTypFilter(f)}
                    className={`font-raleway text-[9px] uppercase tracking-widest transition-colors ${typFilter === f ? 'text-white' : 'text-muted hover:text-white/70'}`}>
                    {f === 'all' ? 'Alle' : f === 'extern' ? 'Extern' : 'Intern'}
                  </button>
                ))}
                <span className="text-border">|</span>
                {(['name', 'datum'] as const).map(s => (
                  <button key={s} type="button" onClick={() => setProjektSort(s)}
                    className={`font-raleway text-[9px] uppercase tracking-widest transition-colors ${projektSort === s ? 'text-white' : 'text-muted hover:text-white/70'}`}>
                    {s === 'name' ? 'A–Z' : 'Neu'}
                  </button>
                ))}
              </div>
            </div>
            <input type="text" placeholder="Projekt suchen…" value={projektSearch}
              onChange={e => setProjektSearch(e.target.value)}
              className="w-full bg-transparent border border-border text-white px-3 py-2 font-opensans text-xs focus:border-white outline-none transition-colors placeholder-muted mb-2" />
            <div className="border border-border divide-y divide-border/40 max-h-36 overflow-y-auto">
              <label className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors select-none ${!projektId ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}>
                <div className={`w-4 h-4 border shrink-0 flex items-center justify-center transition-all ${!projektId ? 'bg-white border-white' : 'border-border'}`}>
                  {!projektId && <span className="text-black text-[10px] leading-none">✓</span>}
                </div>
                <input type="radio" checked={!projektId} onChange={() => { setProjektId(''); }} className="sr-only" />
                <span className="font-opensans text-xs text-muted leading-tight">Kein Projekt</span>
              </label>
              {sortedProjekte.map(p => {
                const isSel = projektId === p.id
                return (
                  <label key={p.id}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors select-none ${isSel ? 'bg-white' : 'hover:bg-white/[0.03]'}`}
                    onClick={() => handleProjektSelect(p.id)}
                  >
                    <div className={`w-4 h-4 border shrink-0 flex items-center justify-center transition-all ${isSel ? 'bg-black border-black' : 'border-border'}`}>
                      {isSel && <span className="text-white text-[10px] leading-none">✓</span>}
                    </div>
                    <span className={`font-opensans text-xs leading-tight flex-1 ${isSel ? 'text-black font-semibold' : 'text-white'}`}>{p.name}</span>
                    {isSel && <span className="font-raleway text-[8px] uppercase tracking-widest text-black/50 shrink-0">Ausgewählt</span>}
                  </label>
                )
              })}
              {sortedProjekte.length === 0 && (
                <div className="px-4 py-3">
                  <span className="font-opensans text-xs text-muted">
                    {typFilter !== 'all'
                      ? `Keine ${typFilter === 'intern' ? 'internen' : 'externen'} Projekte gefunden.`
                      : 'Keine Projekte gefunden.'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving || selectedIds.size === 0}
              className="flex-1 bg-white text-black py-3.5 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40">
              {saving ? 'Wird gespeichert…' : label}
            </button>
            <button type="button" onClick={onClose}
              className="border border-border text-white px-5 py-3.5 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors">
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Eintrag Detail Modal ──────────────────────────────────────────────────────

function EntryDetailModal({ entry, personName, tapDate, onClose, onDelete, onDeleteDay }: {
  entry: DispoEintrag; personName: string; tapDate: string; onClose: () => void
  onDelete: (id: string) => Promise<void>
  onDeleteDay: (entry: DispoEintrag, day: string) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id) }, [])
  const fmt = (d: Date) => `${d.getDate()}. ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`
  const isMultiDay = entry.datum_von !== entry.datum_bis

  const handleDelete = async (dayOnly: boolean) => {
    setDeleting(true); setDeleteError(null)
    try {
      if (dayOnly) await onDeleteDay(entry, tapDate)
      else await onDelete(entry.id)
    } catch (err) {
      setDeleteError(err instanceof Error && err.message.includes('42501') ? 'Keine Berechtigung.' : 'Löschen fehlgeschlagen.')
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: mounted ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)', backdropFilter: 'blur(4px)', transition: 'background 200ms' }}
      onClick={onClose}
    >
      <div
        className="bg-black border border-border w-full max-w-sm"
        style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'scale(1)' : 'scale(0.96)', transition: 'opacity 200ms, transform 200ms' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2 className="font-raleway font-semibold text-white text-xs uppercase tracking-widest">Zuteilung</h2>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <InfoRow label="Person" value={personName} />
          <InfoRow label="Zeitraum"
            value={`${fmt(parseLocalDate(entry.datum_von))} – ${fmt(parseLocalDate(entry.datum_bis))}`} />
          <InfoRow label="Projekt" value={entry.projekt_name ?? '–'} />
          <InfoRow label="Art" value={entry.is_internal ? 'Intern' : 'Extern'} />
          {entry.notiz && <InfoRow label="Notiz" value={entry.notiz} />}
        </div>
        <div className="px-6 pb-5">
          {deleteError && (
            <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3 mb-3">{deleteError}</p>
          )}
          {confirming ? (
            <div className="space-y-2">
              {isMultiDay && tapDate && (
                <button onClick={() => handleDelete(true)} disabled={deleting}
                  className="w-full border border-red-400/40 text-red-400 py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:bg-red-400 hover:text-black transition-colors disabled:opacity-40">
                  {deleting ? 'Löschen…' : `Nur ${fmt(parseLocalDate(tapDate))} löschen`}
                </button>
              )}
              <div className="flex gap-2">
                <button onClick={() => handleDelete(false)} disabled={deleting}
                  className="flex-1 border border-red-400/40 text-red-400 py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:bg-red-400 hover:text-black transition-colors disabled:opacity-40">
                  {deleting ? 'Löschen…' : 'Gesamte Zuteilung'}
                </button>
                <button onClick={() => setConfirming(false)}
                  className="flex-1 border border-border text-muted py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:text-white transition-colors">
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)}
              className="w-full border border-border text-muted py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:border-red-400/40 hover:text-red-400 transition-colors">
              Zuteilung löschen
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Meine Dispo (Mitarbeiter) ─────────────────────────────────────────────────

function MeineDispo({ days, userId }: { days: Date[]; userId: string | null }) {
  const navigate = useNavigate()
  const [eintraege, setEintraege] = useState<DispoEintrag[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedEntry, setSelectedEntry] = useState<DispoEintrag | null>(null)
  const [tapDate, setTapDate] = useState('')
  const weekKeyRef = useRef('')

  const from = fmtDate(days[0]), to = fmtDate(days[6])
  const todayStr = fmtDate(new Date())

  // Realtime: refresh when admin changes this user's entries
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('dispo-meins-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispo_eintraege',
        filter: `user_id=eq.${userId}` }, () => {
        setRefreshKey(k => k + 1)
      })
      .subscribe()
    const onFocus = () => setRefreshKey(k => k + 1)
    window.addEventListener('focus', onFocus)
    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
    }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close any open modal when the user navigates to a different week
  useEffect(() => { setSelectedEntry(null) }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    // Show skeleton on initial load or week navigation; suppress on background refreshes
    const weekKey = `${from}|${to}`
    if (weekKey !== weekKeyRef.current) {
      setLoading(true)
      weekKeyRef.current = weekKey
    }
    setFetchError(false)
    supabase.from('dispo_eintraege').select('*')
      .eq('user_id', userId)
      .lte('datum_von', to).gte('datum_bis', from)
      .then(({ data, error }) => {
        if (error) { setFetchError(true) }
        else { setEintraege((data as DispoEintrag[]) ?? []) }
        setLoading(false)
      })
  }, [from, to, userId, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDate = useMemo(() => {
    const m = new Map<string, DispoEintrag[]>()
    for (const e of eintraege) {
      const von = parseLocalDate(e.datum_von), bis = parseLocalDate(e.datum_bis)
      for (const day of days) {
        if (day >= von && day <= bis) {
          const key = fmtDate(day)
          const arr = m.get(key) ?? []; arr.push(e); m.set(key, arr)
        }
      }
    }
    return m
  }, [eintraege, days])

  if (!userId) return (
    <div className="flex items-center justify-center h-full">
      <p className="font-opensans text-sm text-muted">Kein Profil gefunden.</p>
    </div>
  )

  if (fetchError) return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="font-opensans text-sm text-muted">Daten konnten nicht geladen werden.</p>
      <button
        onClick={() => { setFetchError(false); setLoading(true); setRefreshKey(k => k + 1) }}
        className="border border-border text-white px-4 py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
      >
        Nochmal versuchen
      </button>
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Legende */}
      <div className="flex items-center gap-5 px-4 py-2.5 border-b border-border shrink-0">
        <LegendItem color={{ background: '#fff' }} label="Extern" />
        <LegendItem color={{ background: STRIPE }} label="Intern" />
        <LegendItem color={{ background: '#000', outline: '1px solid #2a2a2a' }} label="Frei" />
      </div>

      {/* Wochengitter */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tag-Kopfzeile */}
        <div className="grid grid-cols-7 shrink-0 border-b border-border">
          {days.map((day, i) => {
            const dateStr = fmtDate(day)
            const isToday = dateStr === todayStr
            return (
              <div key={dateStr}
                className="border-r border-border last:border-r-0 text-center py-3"
                style={{ background: isToday ? '#ffffff' : '#000000' }}
              >
                <p className={`font-raleway text-[9px] uppercase tracking-widest ${isToday ? 'text-black font-semibold' : 'text-muted'}`}>
                  {DAY_SHORT[i]}
                </p>
                <p className={`font-opensans text-sm font-semibold mt-1 ${isToday ? 'text-black' : 'text-white/80'}`}>
                  {day.getDate()}
                </p>
              </div>
            )
          })}
        </div>

        {/* Projekt-Zellen */}
        {loading ? (
          <div className="flex-1 grid grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i}
                className="border-r border-border last:border-r-0 animate-pulse"
                style={{ background: '#080808', animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-7 overflow-hidden border-b border-white/20">
            {days.map(day => {
              const dateStr = fmtDate(day)
              const bookings = byDate.get(dateStr) ?? []
              return (
                <div key={dateStr} className="border-r border-border last:border-r-0 flex flex-col overflow-y-auto">
                  {bookings.length === 0
                    ? <div className="flex-1 bg-black relative">
                        {dateStr === todayStr && <div className="absolute inset-x-0 top-0 h-px bg-white/20" />}
                      </div>
                    : bookings.map(b => {
                        const isInt = b.is_internal
                        return (
                          <div key={b.id}
                            className="flex-1 flex items-center justify-center border-b last:border-b-0 min-h-[72px] cursor-pointer active:opacity-60 overflow-hidden"
                            style={{ background: isInt ? STRIPE : '#ffffff', borderColor: isInt ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}
                            onClick={() => { setSelectedEntry(b); setTapDate(dateStr) }}
                          >
                            <p
                              className="font-raleway font-semibold text-[9px] uppercase tracking-widest select-none"
                              style={{
                                color: '#000',
                                writingMode: 'vertical-lr',
                                textOrientation: 'mixed',
                                maxHeight: '90%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                // Black text on white stripe: clearly visible.
                                // On black stripe: white halo ensures readability.
                                textShadow: isInt ? '0 0 3px rgba(255,255,255,0.95), 0 0 3px rgba(255,255,255,0.95)' : 'none',
                              }}
                            >
                              {b.projekt_name ?? '–'}
                            </p>
                          </div>
                        )
                      })
                  }
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedEntry && (
        <MeineDispoDetailModal
          entry={selectedEntry} tapDate={tapDate}
          onClose={() => setSelectedEntry(null)}
          onDelete={async (id) => {
            const { error } = await supabase.from('dispo_eintraege').delete().eq('id', id)
            if (error) throw new Error(error.message)
            setSelectedEntry(null)
            setRefreshKey(k => k + 1)
          }}
          onDeleteDay={async (entry, day) => {
            const von = entry.datum_von, bis = entry.datum_bis
            if (von === bis) {
              const { error } = await supabase.from('dispo_eintraege').delete().eq('id', entry.id)
              if (error) throw new Error(error.message)
            } else if (day === von) {
              const { error } = await supabase.from('dispo_eintraege').update({ datum_von: nextDay(day) }).eq('id', entry.id)
              if (error) throw new Error(error.message)
            } else if (day === bis) {
              const { error } = await supabase.from('dispo_eintraege').update({ datum_bis: prevDay(day) }).eq('id', entry.id)
              if (error) throw new Error(error.message)
            } else {
              const { error: e1 } = await supabase.from('dispo_eintraege').update({ datum_bis: prevDay(day) }).eq('id', entry.id)
              if (e1) throw new Error(e1.message)
              const { error: e2 } = await supabase.from('dispo_eintraege').insert({
                user_id: entry.user_id, projekt_id: entry.projekt_id, projekt_name: entry.projekt_name,
                is_internal: entry.is_internal, datum_von: nextDay(day), datum_bis: entry.datum_bis, created_by: entry.created_by,
              })
              if (e2) throw new Error(e2.message)
            }
            setSelectedEntry(null)
            setRefreshKey(k => k + 1)
          }}
          onNavigate={selectedEntry.projekt_id ? () => navigate(`/projekt/${selectedEntry.projekt_id}`) : undefined}
        />
      )}
    </div>
  )
}

// ── Meine Dispo Detail Modal ──────────────────────────────────────────────────

function MeineDispoDetailModal({ entry, tapDate, onClose, onDelete, onDeleteDay, onNavigate }: {
  entry: DispoEintrag; tapDate: string
  onClose: () => void
  onDelete: (id: string) => Promise<void>
  onDeleteDay: (entry: DispoEintrag, day: string) => Promise<void>
  onNavigate?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const isMultiDay = entry.datum_von !== entry.datum_bis
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id) }, [])
  const fmt = (d: Date) => `${d.getDate()}. ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4"
      style={{ background: mounted ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0)', backdropFilter: 'blur(4px)', transition: 'background 250ms' }}
      onClick={onClose}
    >
      <div
        className="bg-black border border-border w-full sm:max-w-sm"
        style={{ transform: mounted ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 300ms cubic-bezier(0.32,0.72,0,1)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2 className="font-raleway font-semibold text-white text-xs uppercase tracking-widest truncate pr-4">
            {entry.projekt_name ?? 'Zuteilung'}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Info */}
        <div className="px-6 py-5 space-y-4">
          <InfoRow
            label="Zeitraum"
            value={`${fmt(parseLocalDate(entry.datum_von))} – ${fmt(parseLocalDate(entry.datum_bis))}`}
          />
          <InfoRow label="Art" value={entry.is_internal ? 'Intern' : 'Extern'} />
          {entry.notiz && <InfoRow label="Notiz" value={entry.notiz} />}
        </div>

        {/* Aktionen */}
        <div className="px-6 pb-6 space-y-2">
          {onNavigate && (
            <button
              onClick={onNavigate}
              className="w-full bg-white text-black py-3.5 font-raleway font-semibold text-[10px] uppercase tracking-widest hover:bg-muted transition-colors"
            >
              Zum Projekt
            </button>
          )}
          {deleteError && (
            <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">{deleteError}</p>
          )}
          {confirming ? (
            <div className="space-y-2">
              {isMultiDay && tapDate && (
                <button
                  onClick={async () => {
                    setDeleting(true); setDeleteError(null)
                    try { await onDeleteDay(entry, tapDate) }
                    catch (err) {
                      setDeleteError(err instanceof Error && err.message.includes('42501') ? 'Keine Berechtigung.' : 'Entfernen fehlgeschlagen.')
                      setDeleting(false)
                    }
                  }}
                  disabled={deleting}
                  className="w-full border border-red-400/40 text-red-400 py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:bg-red-400 hover:text-black transition-colors disabled:opacity-40"
                >
                  {deleting ? 'Entfernen…' : `Nur ${fmt(parseLocalDate(tapDate))} entfernen`}
                </button>
              )}
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setDeleting(true); setDeleteError(null)
                    try { await onDelete(entry.id) }
                    catch (err) {
                      setDeleteError(err instanceof Error && err.message.includes('42501') ? 'Keine Berechtigung.' : 'Entfernen fehlgeschlagen.')
                      setDeleting(false)
                    }
                  }}
                  disabled={deleting}
                  className="flex-1 border border-red-400/40 text-red-400 py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:bg-red-400 hover:text-black transition-colors disabled:opacity-40"
                >
                  {deleting ? 'Entfernen…' : 'Gesamte Zuteilung'}
                </button>
                <button onClick={() => setConfirming(false)}
                  className="flex-1 border border-border text-muted py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:text-white transition-colors">
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)}
              className="w-full border border-border text-muted py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:border-red-400/40 hover:text-red-400 transition-colors">
              Zuteilung entfernen
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Hilfskomponenten ──────────────────────────────────────────────────────────

function LegendItem({ color, label }: { color: React.CSSProperties; label: string }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-4 h-4 border border-border shrink-0" style={color} />
      <span className="font-opensans text-[10px] text-muted whitespace-nowrap">{label}</span>
    </div>
  )
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-raleway text-[9px] uppercase tracking-widest text-muted mb-0.5">{label}</p>
      <p className="font-opensans text-sm text-white leading-snug">{value}</p>
    </div>
  )
}
function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="1" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}
function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
