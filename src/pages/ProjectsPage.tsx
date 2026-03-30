import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'
import { CreateProjectModal } from '../components/CreateProjectModal'
import { syncProSonata, shouldAutoSync, PROSONATA_KEY } from '../lib/prosonata'
import type { Project } from '../types'

const STATUS_LABELS: Record<string, string> = {
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
  pausiert: 'Pausiert',
}

function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '')
  const t = norm(text)
  const q = norm(query)
  if (!q) return true
  if (t.includes(q)) return true
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

function isExpired(project: Project): boolean {
  if (!project.enddatum || project.status === 'abgeschlossen') return false
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(23, 59, 59, 999)
  return new Date(project.enddatum) <= yesterday
}

function projectTyp(project: Project): 'intern' | 'extern' {
  return (project.typ ?? 'extern') as 'intern' | 'extern'
}

// ── Cache-Konstanten ─────────────────────────────────────────
const CACHE_KEY = 'ww_projects_v2'
const CACHE_TTL = 3 * 60 * 1000 // 3 Minuten

function readCache(): { projects: Project[]; counts: Record<string, number> } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { ts, projects, counts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return { projects, counts }
  } catch { return null }
}

function writeCache(projects: Project[], counts: Record<string, number>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), projects, counts }))
  } catch { /* quota exceeded – ignore */ }
}

function invalidateCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
}

export function ProjectsPage() {
  const { isAdmin, isAdminOrProjektleiter } = useAuth()
  const [projects, setProjects] = useState<Project[]>(() => readCache()?.projects ?? [])
  const [loading, setLoading] = useState(true)
  const [networkError, setNetworkError] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [filter, setFilter] = useState<'alle' | 'aktiv' | 'abgeschlossen'>('aktiv')
  const [typFilter, setTypFilter] = useState<'alle' | 'intern' | 'extern'>('alle')
  const [search, setSearch] = useState('')
  const [itemCounts, setItemCounts] = useState<Record<string, number>>(() => readCache()?.counts ?? {})
  const [createOpen, setCreateOpen] = useState(false)
  const syncing = useRef(false)
  const mounted = useRef(true)
  // Debounce-Timer für Realtime-Updates (verhindert Spam bei vielen gleichzeitigen Änderungen)
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Online/Offline-Status verfolgen
  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const fetchAndStore = useCallback(async () => {
    const PAGE = 1000

    // Projekte paginiert laden
    let allProjects: Project[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) return null  // Netzwerkfehler → bestehenden Zustand behalten
      if (!data || data.length === 0) break
      allProjects = allProjects.concat(data as Project[])
      if (data.length < PAGE) break
      from += PAGE
    }
    setProjects(allProjects)
    setNetworkError(false)

    // Positionsanzahl paginiert laden
    let allItems: { project_id: string }[] = []
    let itemFrom = 0
    while (true) {
      const { data, error } = await supabase
        .from('project_items')
        .select('project_id')
        .range(itemFrom, itemFrom + PAGE - 1)
      if (error || !data || data.length === 0) break
      allItems = allItems.concat(data)
      if (data.length < PAGE) break
      itemFrom += PAGE
    }
    const counts: Record<string, number> = {}
    for (const item of allItems) {
      counts[item.project_id] = (counts[item.project_id] ?? 0) + 1
    }
    setItemCounts(counts)
    writeCache(allProjects, counts)
    return allProjects
  }, [])

  const load = useCallback(async () => {
    // Cache sofort anzeigen → kein weißer Ladescreen
    const cached = readCache()
    if (cached) {
      setProjects(cached.projects)
      setItemCounts(cached.counts)
      setLoading(false)
    }
    // Im Hintergrund aktualisieren
    const result = await fetchAndStore()
    if (result === null) {
      // Netzwerkfehler: Cache-Daten behalten, Fehler anzeigen wenn kein Cache
      setNetworkError(true)
    }
    setLoading(false)
  }, [fetchAndStore])

  // Debounced-Reload für Realtime (nicht bei jeder einzelnen Änderung neu laden)
  const debouncedLoad = useCallback(() => {
    if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
    realtimeTimer.current = setTimeout(() => {
      if (!mounted.current) return
      invalidateCache()
      fetchAndStore()
    }, 800)
  }, [fetchAndStore])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('projects-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_items' }, debouncedLoad)
      .subscribe()
    return () => {
      mounted.current = false
      supabase.removeChannel(channel)
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
    }
  }, [load, debouncedLoad])

  // Auto-Sync ProSonata (Admin) – bei Öffnen und bei Tab-Focus
  useEffect(() => {
    if (!isAdmin) return
    const apiKey = localStorage.getItem(PROSONATA_KEY)
    if (!apiKey) return

    const doSync = async () => {
      if (syncing.current || !shouldAutoSync()) return
      syncing.current = true
      await syncProSonata(apiKey)
      syncing.current = false
      load()
    }

    doSync()

    const onFocus = () => doSync()
    const onVisibility = () => { if (!document.hidden) doSync() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isAdmin, load])

  // Admin/Projektleiter: abgelaufene Projekte automatisch schließen
  useEffect(() => {
    if (!isAdminOrProjektleiter || projects.length === 0) return
    const expired = projects.filter((p) => p.status === 'aktiv' && isExpired(p))
    if (expired.length === 0) return
    Promise.all(
      expired.map((p) =>
        supabase.from('projects').update({ status: 'abgeschlossen' }).eq('id', p.id)
      )
    ).then(() => {
      if (mounted.current) load()
    }).catch(console.error)
  }, [projects, isAdminOrProjektleiter, load])

  const deleteProject = async (id: string) => {
    if (!window.confirm('Projekt wirklich löschen? Alle Positionen werden ebenfalls gelöscht.')) return
    await supabase.from('project_items').delete().eq('project_id', id)
    await supabase.from('projects').delete().eq('id', id)
    load()
  }

  // Status-Filter (Mitarbeiter sehen nur aktiv)
  const byStatus = isAdminOrProjektleiter
    ? (filter === 'alle' ? projects : projects.filter((p) => p.status === filter))
    : projects.filter((p) => p.status === 'aktiv')

  // Typ-Filter (intern/extern)
  const byTyp = typFilter === 'alle'
    ? byStatus
    : byStatus.filter((p) => projectTyp(p) === typFilter)

  // Suche
  const filtered = search.trim()
    ? byTyp.filter((p) =>
        fuzzyMatch(p.name, search) ||
        (p.beschreibung ? fuzzyMatch(p.beschreibung, search) : false)
      )
    : byTyp

  // Abgeschlossene: zuletzt abgeschlossen zuerst (Enddatum DESC)
  const sorted = [...filtered].sort((a, b) => {
    const bothClosed = a.status === 'abgeschlossen' && b.status === 'abgeschlossen'
    if (!bothClosed) return 0
    const ta = a.enddatum
      ? new Date(a.enddatum).getTime()
      : new Date(a.updated_at).getTime()
    const tb = b.enddatum
      ? new Date(b.enddatum).getTime()
      : new Date(b.updated_at).getTime()
    return tb - ta
  })

  return (
    <div className="min-h-screen bg-black overflow-x-hidden">
      <Header />
      <main
        className="max-w-screen-lg mx-auto px-4"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 4rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)',
        }}
      >
        {/* Offline / Netzwerkfehler-Banner */}
        {(!isOnline || networkError) && (
          <div className="mb-4 px-4 py-3 border border-yellow-400/40 text-yellow-400 font-opensans text-xs flex items-center gap-2">
            <span>⚡</span>
            <span>
              {!isOnline
                ? 'Kein Internet – gespeicherte Daten werden angezeigt. Änderungen sind erst nach Verbindungswiederherstellung möglich.'
                : 'Verbindungsproblem – Daten möglicherweise veraltet.'}
            </span>
          </div>
        )}

        {/* Seitenkopf */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 border-b border-border pb-6 mt-6">
          <div>
            <h1 className="font-raleway font-semibold text-white text-2xl uppercase tracking-widest">
              Warenwirtschaft
            </h1>
            <p className="text-muted font-opensans text-xs mt-1">
              {sorted.length} Projekt{sorted.length !== 1 ? 'e' : ''}
              {isAdminOrProjektleiter ? ` · ${projects.length} gesamt` : ' aktiv'}
            </p>
          </div>
          {isAdminOrProjektleiter && (
            <button
              onClick={() => setCreateOpen(true)}
              className="bg-white text-black px-5 py-2.5 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors self-start sm:self-auto whitespace-nowrap"
            >
              + Neues Projekt
            </button>
          )}
        </div>

        {/* Status-Filter (Admin + Projektleiter) */}
        {isAdminOrProjektleiter && (
          <div className="mb-3 flex border border-border overflow-hidden">
            {(['aktiv', 'abgeschlossen', 'alle'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-3 font-raleway text-[10px] uppercase tracking-widest transition-colors whitespace-nowrap ${
                  filter === f ? 'bg-white text-black font-semibold' : 'text-muted hover:text-white'
                }`}
              >
                {f === 'aktiv' ? 'Aktiv' : f === 'abgeschlossen' ? 'Abgeschlossen' : 'Alle'}
              </button>
            ))}
          </div>
        )}

        {/* Typ-Filter (Intern / Extern) */}
        <div className="mb-5 flex border border-border overflow-hidden">
          {(['alle', 'extern', 'intern'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypFilter(t)}
              className={`flex-1 py-2.5 font-raleway text-[10px] uppercase tracking-widest transition-colors whitespace-nowrap ${
                typFilter === t ? 'bg-white text-black font-semibold' : 'text-muted hover:text-white'
              }`}
            >
              {t === 'alle' ? 'Alle' : t === 'intern' ? 'Intern' : 'Extern'}
            </button>
          ))}
        </div>

        {/* Suche */}
        <div className="mb-6 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Projekt suchen…"
            className="w-full bg-transparent border border-border px-4 py-3 text-white font-opensans text-sm placeholder:text-muted outline-none focus:border-white transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Projektliste */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="border border-border p-12 text-center">
            <p className="text-muted font-opensans text-sm">
              {networkError && projects.length === 0
                ? 'Keine Daten verfügbar. Bitte Internetverbindung prüfen.'
                : 'Keine Projekte gefunden.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
            {sorted.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                itemCount={itemCounts[project.id] ?? 0}
                isAdminOrProjektleiter={isAdminOrProjektleiter}
                isAdmin={isAdmin}
                onRefresh={load}
                onDelete={deleteProject}
              />
            ))}
          </div>
        )}
      </main>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); load() }}
      />
    </div>
  )
}

// ── Projekt-Karte ────────────────────────────────────────────

function ProjectCard({
  project,
  itemCount,
  isAdminOrProjektleiter,
  isAdmin,
  onRefresh,
  onDelete,
}: {
  project: Project
  itemCount: number
  isAdminOrProjektleiter: boolean
  isAdmin: boolean
  onRefresh: () => void
  onDelete: (id: string) => void
}) {
  const [updating, setUpdating] = useState(false)

  const cycleStatus = async () => {
    const next: Record<string, string> = {
      aktiv: 'abgeschlossen',
      pausiert: 'abgeschlossen',
      abgeschlossen: 'aktiv',
    }
    setUpdating(true)
    await supabase.from('projects').update({ status: next[project.status] }).eq('id', project.id)
    setUpdating(false)
    onRefresh()
  }

  const statusColor: Record<string, string> = {
    aktiv: 'text-green-400',
    pausiert: 'text-yellow-400',
    abgeschlossen: 'text-muted',
  }

  const typ = projectTyp(project)

  return (
    <div className="bg-black p-5 flex flex-col gap-3 hover:bg-surface transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/projekt/${project.id}`} className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h2 className="font-raleway font-semibold text-white text-sm uppercase tracking-wide group-hover:underline">
              {project.name}
            </h2>
            <span className={`text-[9px] font-raleway uppercase tracking-wider px-1.5 py-0.5 border ${
              typ === 'intern' ? 'border-white/20 text-white/50' : 'border-border text-muted'
            }`}>
              {typ === 'intern' ? 'Intern' : 'Extern'}
            </span>
          </div>
          {project.beschreibung && (
            <p className="text-muted text-xs font-opensans line-clamp-2">
              {project.beschreibung}
            </p>
          )}
        </Link>
        {isAdmin ? (
          <button
            onClick={cycleStatus}
            disabled={updating}
            title="Status ändern"
            className={`text-xs font-raleway uppercase tracking-wider shrink-0 ${statusColor[project.status]} hover:text-white transition-colors`}
          >
            {STATUS_LABELS[project.status]}
          </button>
        ) : isAdminOrProjektleiter ? (
          <span className={`text-xs font-raleway uppercase tracking-wider shrink-0 ${statusColor[project.status]}`}>
            {STATUS_LABELS[project.status]}
          </span>
        ) : null}
      </div>

      {isAdmin && (
        <button
          onClick={(e) => { e.preventDefault(); onDelete(project.id) }}
          className="text-xs text-red-400 hover:text-red-300 font-raleway uppercase tracking-widest transition-colors shrink-0 text-left"
        >
          Löschen
        </button>
      )}

      <div className="border-t border-border pt-3 space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-muted font-opensans text-xs">
            <span className="text-white font-medium">{itemCount}</span>{' '}
            Position{itemCount !== 1 ? 'en' : ''}
          </div>
          {project.enddatum && (
            <time className={`text-xs font-opensans ${isExpired(project) ? 'text-red-400' : 'text-muted'}`}>
              bis {new Date(project.enddatum).toLocaleDateString('de-AT')}
            </time>
          )}
        </div>
        {!project.enddatum && (
          <div className="text-right">
            <time className="text-muted text-xs font-opensans">
              {new Date(project.created_at).toLocaleDateString('de-AT')}
            </time>
          </div>
        )}
      </div>

      <Link
        to={`/projekt/${project.id}`}
        className="block border border-border text-center py-2 font-raleway text-xs uppercase tracking-widest text-white hover:bg-white hover:text-black transition-colors"
      >
        Öffnen →
      </Link>
    </div>
  )
}
