import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'

// ── Datum-Helpers ──────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function parseLocalDate(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

function getWeekStart(date: Date): Date {
  const d = new Date(date); d.setHours(0, 0, 0, 0)
  const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return d
}
function getWeekDays(ws: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d })
}
function isWeekend(d: Date) { const day = d.getDay(); return day === 0 || day === 6 }

function getEaster(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  return new Date(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1)
}

function getAustrianHolidays(year: number): Set<string> {
  const h = new Set<string>()
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const add = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
  ;[`${year}-01-01`,`${year}-01-06`,`${year}-05-01`,`${year}-08-15`,
    `${year}-10-26`,`${year}-11-01`,`${year}-12-08`,`${year}-12-25`,`${year}-12-26`].forEach(s => h.add(s))
  const e = getEaster(year)
  h.add(fmt(add(e,1))); h.add(fmt(add(e,39))); h.add(fmt(add(e,50))); h.add(fmt(add(e,60)))
  return h
}

// ── Typen ─────────────────────────────────────────────────────────────────────

interface DispoEintrag {
  id: string; user_id: string; projekt_id: string | null; projekt_name: string | null
  is_internal: boolean; datum_von: string; datum_bis: string; notiz: string | null
  created_by: string | null; created_at: string
}
interface PersonProfile { id: string; name: string | null; rolle: string | null; email: string | null }
interface Projekt { id: string; name: string; typ: 'intern' | 'extern' | null }

const STRIPE = 'repeating-linear-gradient(-45deg,#fff,#fff 3px,#000 3px,#000 6px)'

// ── Passwortschutz (mit Header) ───────────────────────────────────────────────

const DISPO_KEY = 'dispo_unlocked'
const DISPO_PW = 'EarlyAccess'

function DispoPasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pw === DISPO_PW) { sessionStorage.setItem(DISPO_KEY, '1'); onUnlock() }
    else { setError(true); setPw('') }
  }

  return (
    <div className="min-h-screen bg-black">
      <Header />
      <div
        className="flex flex-col items-center justify-center px-4"
        style={{
          minHeight: '100vh',
          paddingTop: 'calc(env(safe-area-inset-top) + 56px + 4rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)',
        }}
      >
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-2">
            <ClockIcon className="w-10 h-10 text-white/30" />
            <h1 className="font-raleway font-semibold text-white text-lg uppercase tracking-widest mt-2">Dispo</h1>
            <p className="text-muted font-opensans text-xs text-center">
              Diese Funktion befindet sich im Early Access.<br />Bitte Zugangscode eingeben.
            </p>
          </div>
          <div className="border-t border-border mb-6" />
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">Zugangscode</label>
              <input
                type="password" value={pw} onChange={e => { setPw(e.target.value); setError(false) }}
                autoFocus autoComplete="off" placeholder="••••••••••"
                className="w-full bg-transparent border border-border text-white px-4 py-3.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
              />
            </div>
            {error && <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">Falscher Zugangscode.</p>}
            <button type="submit" disabled={!pw}
              className="w-full bg-white text-black py-4 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40">
              Zugang
            </button>
          </form>
          <div className="border-b border-border mt-6" />
        </div>
      </div>
    </div>
  )
}

// ── Hauptseite ────────────────────────────────────────────────────────────────

export function DispoPage() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(DISPO_KEY) === '1')
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
    const f = days[0], t = days[6]
    return `${f.getDate()}. ${MONTH_NAMES[f.getMonth()]} – ${t.getDate()}. ${MONTH_NAMES[t.getMonth()]} ${t.getFullYear()}`
  }, [days])

  const prevWeek = () => setWeekStart(p => { const d = new Date(p); d.setDate(d.getDate() - 7); return d })
  const nextWeek = () => setWeekStart(p => { const d = new Date(p); d.setDate(d.getDate() + 7); return d })

  if (!unlocked) return <DispoPasswordGate onUnlock={() => setUnlocked(true)} />

  return (
    <div className="bg-black flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      <Header />
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 56px)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Name + Projektzuteilung (nur Mitarbeiter) */}
        {!isAdminOrProjektleiter && (
          <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
            <h1 className="font-raleway font-semibold text-white text-xl uppercase tracking-widest leading-tight">
              {profile?.name ?? '–'}
            </h1>
            <p className="text-muted font-opensans text-xs mt-0.5">Projektzuteilung</p>
          </div>
        )}

        {/* Wochennavigation – zentriert */}
        <div className="flex items-center justify-center gap-3 py-3 border-b border-border shrink-0 px-4">
          <button onClick={prevWeek}
            className="border border-border text-white w-8 h-8 flex items-center justify-center hover:bg-white hover:text-black transition-colors text-sm shrink-0">
            ←
          </button>
          <span className="font-opensans text-sm text-white text-center">{weekLabel}</span>
          <button onClick={nextWeek}
            className="border border-border text-white w-8 h-8 flex items-center justify-center hover:bg-white hover:text-black transition-colors text-sm shrink-0">
            →
          </button>
        </div>

        {/* Hauptinhalt */}
        <div className="flex-1 overflow-hidden">
          {isAdminOrProjektleiter ? (
            <DispoMatrix days={days} holidays={holidays} />
          ) : (
            <MeineDispo days={days} holidays={holidays} userId={profile?.id ?? null} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Matrix-Ansicht (Admin / Projektleitung) ───────────────────────────────────

const COL = '56px repeat(7, 1fr)'

function DispoMatrix({ days, holidays }: { days: Date[]; holidays: Set<string> }) {
  const { user } = useAuth()
  const [persons, setPersons] = useState<PersonProfile[]>([])
  const [eintraege, setEintraege] = useState<DispoEintrag[]>([])
  const [projekte, setProjekte] = useState<Projekt[]>([])
  const [loading, setLoading] = useState(true)
  const [showNeu, setShowNeu] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<DispoEintrag | null>(null)
  const [selectedPersonName, setSelectedPersonName] = useState<string | null>(null)

  const from = fmtDate(days[0]), to = fmtDate(days[6])

  useEffect(() => { loadAll() }, [])
  useEffect(() => { loadEintraege() }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const { data } = await supabase.from('dispo_eintraege').select('*').lte('datum_von', to).gte('datum_bis', from)
    setEintraege((data as DispoEintrag[]) ?? [])
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
    await supabase.from('dispo_eintraege').delete().eq('id', id)
    await loadEintraege(); setSelectedEntry(null)
  }

  const todayStr = fmtDate(new Date())

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Aktionsleiste */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border shrink-0 overflow-x-auto">
        <button onClick={() => setShowNeu(true)}
          className="group inline-flex items-center gap-2 border border-border px-4 py-2 hover:border-white hover:bg-white transition-colors shrink-0">
          <ClockIcon className="w-4 h-4 text-white group-hover:text-black transition-colors" />
          <span className="font-raleway font-semibold text-white group-hover:text-black text-[10px] uppercase tracking-widest transition-colors whitespace-nowrap">
            Neue Zuteilung
          </span>
        </button>
        <div className="flex items-center gap-4 shrink-0">
          <LegendItem color={{ background: '#fff' }} label="Extern" />
          <LegendItem color={{ background: STRIPE }} label="Intern" />
          <LegendItem color={{ background: '#000', outline: '1px solid #333' }} label="Kein Projekt" />
        </div>
      </div>

      {/* Grid – scrollt vertikal, nie horizontal */}
      {loading ? (
        <div className="flex-1 grid" style={{ gridTemplateColumns: COL }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border-r border-b border-border animate-pulse bg-white/[0.03]" />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Header-Zeile */}
          <div className="grid sticky top-0 z-10 bg-black" style={{ gridTemplateColumns: COL }}>
            <div className="border border-border px-1 py-2 text-[9px] font-raleway uppercase tracking-widest text-muted text-center">
              Name
            </div>
            {days.map((day, i) => {
              const dateStr = fmtDate(day)
              const isToday = dateStr === todayStr
              return (
                <div key={dateStr}
                  className={`border border-border text-center py-2 px-0.5 ${isToday ? 'border-white/40' : ''}`}
                  style={{ background: isToday ? '#ffffff' : '#000000' }}>
                  <p className={`font-raleway text-[9px] uppercase tracking-widest ${isToday ? 'text-black' : 'text-muted'}`}>
                    {DAY_SHORT[i]}
                  </p>
                  <p className={`font-opensans text-[11px] mt-0.5 ${isToday ? 'text-black font-semibold' : 'text-white'}`}>
                    {day.getDate()}.
                  </p>
                </div>
              )
            })}
          </div>

          {/* Personen-Zeilen */}
          {persons.length === 0 ? (
            <div className="grid" style={{ gridTemplateColumns: COL }}>
              <div className="col-span-8 border border-border px-4 py-8 text-center">
                <span className="font-opensans text-sm text-muted">Keine Benutzer gefunden.</span>
              </div>
            </div>
          ) : persons.map(person => (
            <div key={person.id} className="grid" style={{ gridTemplateColumns: COL }}>
              <div className="border border-border px-1 py-2 bg-black overflow-hidden">
                <span className="font-opensans text-[10px] text-white block truncate leading-tight">
                  {person.name ?? person.email ?? '–'}
                </span>
              </div>
              {days.map(day => {
                const dateStr = fmtDate(day)
                const cellEntries = cellMap.get(`${person.id}|${dateStr}`) ?? []
                const hasExt = cellEntries.some(e => !e.is_internal)
                const hasInt = cellEntries.some(e => e.is_internal)
                const title = cellEntries.length > 0
                  ? [...new Set(cellEntries.map(e => e.projekt_name).filter(Boolean))].join(', ') || 'Projekt'
                  : 'Kein Projekt'

                let bg = '#000000'
                if (hasExt) bg = '#ffffff'
                else if (hasInt) bg = STRIPE

                return (
                  <div key={dateStr}
                    className="border border-border h-9 cursor-pointer hover:opacity-70 transition-opacity"
                    style={{ background: bg }} title={title}
                    onClick={() => { if (cellEntries.length > 0) { setSelectedEntry(cellEntries[0]); setSelectedPersonName(person.name ?? person.email ?? '–') } }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      )}

      {showNeu && (
        <NeuZuteilungModal persons={persons} projekte={projekte}
          defaultFrom={fmtDate(days[0])} defaultTo={fmtDate(days[4])}
          createdBy={user?.id ?? null}
          onClose={() => setShowNeu(false)}
          onSaved={() => { setShowNeu(false); loadEintraege() }} />
      )}
      {selectedEntry && (
        <EntryDetailModal entry={selectedEntry} personName={selectedPersonName ?? '–'}
          onClose={() => setSelectedEntry(null)} onDelete={deleteEntry} />
      )}
    </div>
  )
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
  const [isInternal, setIsInternal] = useState(false)
  const [notiz, setNotiz] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filteredPersons = useMemo(
    () => persons.filter(p => (p.name ?? p.email ?? '').toLowerCase().includes(search.toLowerCase())),
    [persons, search]
  )

  const handleProjektChange = (id: string) => {
    setProjektId(id)
    if (id) { const p = projekte.find(p => p.id === id); if (p) setIsInternal(p.typ === 'intern') }
  }
  const togglePerson = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll = () => setSelectedIds(new Set(filteredPersons.map(p => p.id)))
  const selectNone = () => setSelectedIds(new Set())

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (selectedIds.size === 0) { setError('Bitte mindestens eine Person auswählen.'); return }
    if (datumVon > datumBis) { setError('Von-Datum muss vor dem Bis-Datum liegen.'); return }
    setSaving(true); setError(null)
    const proj = projektId ? projekte.find(p => p.id === projektId) : null
    const { error: dbErr } = await supabase.from('dispo_eintraege').insert(
      Array.from(selectedIds).map(userId => ({
        user_id: userId, projekt_id: projektId || null,
        projekt_name: proj?.name ?? null, is_internal: isInternal,
        datum_von: datumVon, datum_bis: datumBis,
        notiz: notiz.trim() || null, created_by: createdBy,
      }))
    )
    if (dbErr) { setError('Fehler: ' + dbErr.message); setSaving(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-black border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <ClockIcon className="w-5 h-5 text-white" />
            <h2 className="font-raleway font-semibold text-white text-sm uppercase tracking-widest">Neue Zuteilung</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
          {/* Zeitraum */}
          <div>
            <p className="font-raleway text-[10px] uppercase tracking-widest text-muted mb-3">Zeitraum</p>
            <div className="grid grid-cols-2 gap-3">
              {[['Von', datumVon, setDatumVon, ''], ['Bis', datumBis, setDatumBis, datumVon]].map(([lbl, val, set, min]) => (
                <div key={lbl as string}>
                  <label className="block text-[10px] uppercase tracking-widest text-muted font-raleway mb-1.5">{lbl as string}</label>
                  <input type="date" value={val as string} min={min as string} required
                    onChange={e => (set as (v: string) => void)(e.target.value)}
                    className="w-full bg-transparent border border-border text-white px-3 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors" />
                </div>
              ))}
            </div>
          </div>
          {/* Personen */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="font-raleway text-[10px] uppercase tracking-widest text-muted">
                Personen {selectedIds.size > 0 && <span className="text-white">({selectedIds.size})</span>}
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={selectAll} className="font-raleway text-[9px] uppercase tracking-widest text-muted hover:text-white transition-colors">Alle</button>
                <button type="button" onClick={selectNone} className="font-raleway text-[9px] uppercase tracking-widest text-muted hover:text-white transition-colors">Keine</button>
              </div>
            </div>
            <input type="text" placeholder="Suchen…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-transparent border border-border text-white px-3 py-2 font-opensans text-xs focus:border-white outline-none transition-colors placeholder-muted mb-2" />
            <div className="border border-border divide-y divide-border max-h-48 overflow-y-auto">
              {filteredPersons.map(p => (
                <label key={p.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${selectedIds.has(p.id) ? 'bg-white/5' : ''}`}>
                  <div className={`w-4 h-4 border shrink-0 flex items-center justify-center transition-colors ${selectedIds.has(p.id) ? 'bg-white border-white' : 'border-border'}`}>
                    {selectedIds.has(p.id) && <span className="text-black text-[10px] leading-none font-bold">✓</span>}
                  </div>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => togglePerson(p.id)} className="sr-only" />
                  <span className="font-opensans text-xs text-white">{p.name ?? p.email ?? '–'}</span>
                </label>
              ))}
            </div>
          </div>
          {/* Projekt */}
          <div>
            <label className="block font-raleway text-[10px] uppercase tracking-widest text-muted mb-1.5">Projekt (optional)</label>
            <select value={projektId} onChange={e => handleProjektChange(e.target.value)}
              className="w-full bg-black border border-border text-white px-3 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors">
              <option value="">– Kein Projekt –</option>
              {projekte.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {/* Art */}
          <div>
            <p className="font-raleway text-[10px] uppercase tracking-widest text-muted mb-2">Art</p>
            <div className="flex gap-3">
              {([['Extern', false], ['Intern', true]] as const).map(([lbl, val]) => (
                <button key={lbl} type="button" onClick={() => setIsInternal(val)}
                  className={`flex-1 py-2.5 border font-raleway text-[10px] uppercase tracking-widest transition-colors ${isInternal === val ? 'bg-white text-black border-white' : 'border-border text-muted hover:border-white hover:text-white'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {/* Notiz */}
          <div>
            <label className="block font-raleway text-[10px] uppercase tracking-widest text-muted mb-1.5">Notiz (optional)</label>
            <textarea value={notiz} onChange={e => setNotiz(e.target.value)} rows={2} placeholder="z. B. Baustelle XY…"
              className="w-full bg-transparent border border-border text-white px-3 py-2 font-opensans text-sm focus:border-white outline-none transition-colors resize-none placeholder-muted" />
          </div>
          {error && <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving || selectedIds.size === 0}
              className="flex-1 bg-white text-black py-3 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40">
              {saving ? 'Wird gespeichert…' : `${selectedIds.size || ''} ${selectedIds.size === 1 ? 'Person' : 'Personen'} zuteilen`}
            </button>
            <button type="button" onClick={onClose}
              className="border border-border text-white px-5 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors">
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Eintrag Detail Modal ──────────────────────────────────────────────────────

function EntryDetailModal({ entry, personName, onClose, onDelete }: {
  entry: DispoEintrag; personName: string; onClose: () => void; onDelete: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fmt = (d: Date) => `${d.getDate()}. ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-black border border-border w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2 className="font-raleway font-semibold text-white text-sm uppercase tracking-widest">Zuteilung</h2>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors text-lg leading-none">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <InfoRow label="Person" value={personName} />
          <InfoRow label="Zeitraum" value={`${fmt(parseLocalDate(entry.datum_von))} – ${fmt(parseLocalDate(entry.datum_bis))}`} />
          <InfoRow label="Projekt" value={entry.projekt_name ?? '–'} />
          <InfoRow label="Art" value={entry.is_internal ? 'Intern' : 'Extern'} />
          {entry.notiz && <InfoRow label="Notiz" value={entry.notiz} />}
        </div>
        <div className="px-6 pb-6">
          {confirming ? (
            <div className="space-y-2">
              <p className="font-opensans text-xs text-muted mb-3">Zuteilung wirklich löschen?</p>
              <div className="flex gap-2">
                <button onClick={async () => { setDeleting(true); await onDelete(entry.id); setDeleting(false) }}
                  disabled={deleting}
                  className="flex-1 border border-red-400/50 text-red-400 py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:bg-red-400 hover:text-black transition-colors disabled:opacity-40">
                  {deleting ? 'Löschen…' : 'Ja, löschen'}
                </button>
                <button onClick={() => setConfirming(false)}
                  className="flex-1 border border-border text-muted py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:text-white transition-colors">
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)}
              className="w-full border border-border text-muted py-2.5 font-raleway text-[10px] uppercase tracking-widest hover:border-red-400/50 hover:text-red-400 transition-colors">
              Zuteilung löschen
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Meine Dispo (Mitarbeiter) ─────────────────────────────────────────────────

function MeineDispo({ days, holidays, userId }: { days: Date[]; holidays: Set<string>; userId: string | null }) {
  const navigate = useNavigate()
  const [eintraege, setEintraege] = useState<DispoEintrag[]>([])
  const [loading, setLoading] = useState(true)

  const from = fmtDate(days[0]), to = fmtDate(days[6])
  const todayStr = fmtDate(new Date())

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    setLoading(true)
    supabase.from('dispo_eintraege').select('*').eq('user_id', userId).lte('datum_von', to).gte('datum_bis', from)
      .then(({ data }) => { setEintraege((data as DispoEintrag[]) ?? []); setLoading(false) })
  }, [from, to, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDate = useMemo(() => {
    const m = new Map<string, DispoEintrag[]>()
    for (const e of eintraege) {
      const von = parseLocalDate(e.datum_von), bis = parseLocalDate(e.datum_bis)
      for (const day of days) {
        if (day >= von && day <= bis) {
          const key = fmtDate(day); const arr = m.get(key) ?? []; arr.push(e); m.set(key, arr)
        }
      }
    }
    return m
  }, [eintraege, days])

  if (!userId) return (
    <div className="flex items-center justify-center h-full">
      <p className="font-opensans text-sm text-muted">Kein Benutzer-Profil gefunden.</p>
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Legende – immer eine Zeile */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border shrink-0">
        <LegendItem color={{ background: '#fff' }} label="Extern" />
        <LegendItem color={{ background: STRIPE }} label="Intern" />
        <LegendItem color={{ background: '#000', outline: '1px solid #333' }} label="Kein Projekt" />
      </div>

      {/* Grid – füllt restliche Höhe */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tag-Header */}
        <div className="grid grid-cols-7 shrink-0 border-b border-border">
          {days.map((day, i) => {
            const dateStr = fmtDate(day)
            const isToday = dateStr === todayStr
            return (
              <div key={dateStr} className="border-r border-border text-center py-2.5 px-0.5 last:border-r-0"
                style={{ background: isToday ? '#ffffff' : '#000000' }}>
                <p className={`font-raleway font-semibold text-[9px] uppercase tracking-widest ${isToday ? 'text-black' : 'text-muted'}`}>
                  {DAY_SHORT[i]}
                </p>
                <p className={`font-opensans text-sm font-medium mt-0.5 ${isToday ? 'text-black' : 'text-white'}`}>
                  {day.getDate()}.
                </p>
              </div>
            )
          })}
        </div>

        {/* Projekt-Zellen */}
        {loading ? (
          <div className="flex-1 grid grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="border-r border-border last:border-r-0 animate-pulse"
                style={{ background: 'repeating-linear-gradient(45deg, #111 0px, #111 4px, #0a0a0a 4px, #0a0a0a 8px)' }} />
            ))}
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-7 overflow-hidden">
            {days.map(day => {
              const dateStr = fmtDate(day)
              const bookings = byDate.get(dateStr) ?? []
              return (
                <div key={dateStr} className="border-r border-border last:border-r-0 flex flex-col overflow-y-auto">
                  {bookings.length === 0 ? (
                    <div className="flex-1 bg-black" />
                  ) : (
                    bookings.map(b => {
                      const bg = b.is_internal ? STRIPE : '#ffffff'
                      const color = b.is_internal ? '#ffffff' : '#000000'
                      return (
                        <div key={b.id}
                          className={`flex-1 flex flex-col justify-start p-1.5 border-b border-black/20 last:border-b-0 ${b.projekt_id ? 'cursor-pointer hover:opacity-75 transition-opacity' : ''}`}
                          style={{ background: bg, minHeight: '60px' }}
                          onClick={() => { if (b.projekt_id) navigate(`/projekt/${b.projekt_id}`) }}>
                          <p className="font-opensans text-[10px] font-medium leading-snug" style={{ color }}>
                            {b.projekt_name ?? '–'}
                          </p>
                          {b.notiz && (
                            <p className="font-opensans text-[8px] mt-0.5 opacity-60" style={{ color }}>
                              {b.notiz}
                            </p>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>
        )}
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
      <p className="font-raleway text-[10px] uppercase tracking-widest text-muted mb-0.5">{label}</p>
      <p className="font-opensans text-sm text-white">{value}</p>
    </div>
  )
}
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
