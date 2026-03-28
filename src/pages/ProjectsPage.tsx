import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'
import type { Project } from '../types'

const STATUS_LABELS: Record<string, string> = {
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
  pausiert: 'Pausiert', // legacy
}

// Fuzzy-Suche: Groß-/Kleinschreibung egal, Umlaute egal, kleine Tippfehler egal
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
  // Subsequenz-Match: alle Buchstaben des Suchbegriffs kommen in richtiger Reihenfolge vor
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

// Prüft ob ein Projekt abgelaufen ist (Enddatum war gestern oder früher)
function isExpired(project: Project): boolean {
  if (!project.enddatum || project.status === 'abgeschlossen') return false
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(23, 59, 59, 999)
  return new Date(project.enddatum) <= yesterday
}

export function ProjectsPage() {
  const { isAdmin, isAdminOrProjektleiter } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'alle' | 'aktiv' | 'abgeschlossen'>('aktiv')
  const [search, setSearch] = useState('')
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    const list = (data as Project[]) ?? []
    setProjects(list)

    if (list.length > 0) {
      const { data: items } = await supabase
        .from('project_items')
        .select('project_id')
      const counts: Record<string, number> = {}
      for (const item of (items ?? [])) {
        counts[item.project_id] = (counts[item.project_id] ?? 0) + 1
      }
      setItemCounts(counts)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('projects-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_items' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  // Admin: Projekte automatisch auf "abgeschlossen" setzen wenn Enddatum vorbei
  useEffect(() => {
    if (!isAdmin || projects.length === 0) return
    const expired = projects.filter(
      (p) => p.status === 'aktiv' && isExpired(p)
    )
    if (expired.length === 0) return
    Promise.all(
      expired.map((p) =>
        supabase.from('projects').update({ status: 'abgeschlossen' }).eq('id', p.id)
      )
    ).then(() => load())
  }, [projects, isAdmin, load])

  const deleteProject = async (id: string) => {
    if (!window.confirm('Projekt wirklich löschen? Alle Positionen werden ebenfalls gelöscht.')) return
    await supabase.from('project_items').delete().eq('project_id', id)
    await supabase.from('projects').delete().eq('id', id)
    load()
  }

  // Mitarbeiter sehen nur aktive Projekte, kein Filter
  const byStatus = isAdminOrProjektleiter
    ? (filter === 'alle' ? projects : projects.filter((p) => p.status === filter))
    : projects.filter((p) => p.status === 'aktiv')

  // Suchfilter
  const filtered = search.trim()
    ? byStatus.filter((p) =>
        fuzzyMatch(p.name, search) ||
        (p.beschreibung ? fuzzyMatch(p.beschreibung, search) : false)
      )
    : byStatus

  return (
    <div className="min-h-screen bg-black overflow-x-hidden">
      <Header />
      <main
        className="max-w-screen-lg mx-auto px-4 pb-16"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 4rem)' }}
      >

        {/* Seitenkopf */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 border-b border-border pb-6 mt-6">
          <div>
            <h1 className="font-raleway font-semibold text-white text-2xl uppercase tracking-widest">
              Warenwirtschaft
            </h1>
            <p className="text-muted font-opensans text-xs mt-1">
              {filtered.length} Projekt{filtered.length !== 1 ? 'e' : ''}
              {isAdminOrProjektleiter ? ` · ${projects.length} gesamt` : ' aktiv'}
            </p>
          </div>
        </div>

        {/* Filter – nur für Admin und Projektleiter */}
        {isAdminOrProjektleiter && (
          <div className="mb-4 flex border border-border overflow-hidden">
            {(['aktiv', 'abgeschlossen', 'alle'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-3 font-raleway text-[9px] sm:text-[11px] uppercase tracking-widest transition-colors whitespace-nowrap ${
                  filter === f ? 'bg-white text-black font-semibold' : 'text-muted hover:text-white'
                }`}
              >
                {f === 'aktiv' ? 'Aktiv' : f === 'abgeschlossen' ? 'Abgeschlossen' : 'Alle'}
              </button>
            ))}
          </div>
        )}

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
        ) : filtered.length === 0 ? (
          <div className="border border-border p-12 text-center">
            <p className="text-muted font-opensans text-sm">
              {projects.filter(p => p.status === 'aktiv').length === 0
                ? 'Noch keine aktiven Projekte.'
                : 'Keine Projekte in dieser Kategorie.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                itemCount={itemCounts[project.id] ?? 0}
                isAdminOrProjektleiter={isAdminOrProjektleiter}
                onRefresh={load}
                onDelete={deleteProject}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ── Projekt-Karte ────────────────────────────────────────────

function ProjectCard({
  project,
  itemCount,
  isAdminOrProjektleiter,
  onRefresh,
  onDelete,
}: {
  project: Project
  itemCount: number
  isAdminOrProjektleiter: boolean
  onRefresh: () => void
  onDelete: (id: string) => void
}) {
  const { isAdmin } = useAuth()
  const [updating, setUpdating] = useState(false)

  const cycleStatus = async () => {
    const next: Record<string, string> = {
      aktiv: 'abgeschlossen',
      pausiert: 'abgeschlossen', // legacy → direkt abschließen
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

  return (
    <div className="bg-black p-5 flex flex-col gap-3 hover:bg-surface transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/projekt/${project.id}`} className="flex-1 min-w-0">
          <h2 className="font-raleway font-semibold text-white text-sm uppercase tracking-wide group-hover:underline truncate">
            {project.name}
          </h2>
          {project.beschreibung && (
            <p className="text-muted text-xs font-opensans mt-1 line-clamp-2">
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
          title="Projekt löschen"
        >
          Löschen
        </button>
      )}

      <div className="border-t border-border pt-3 flex items-center justify-between">
        <div className="text-muted font-opensans text-xs">
          <span className="text-white font-medium">{itemCount}</span> Position{itemCount !== 1 ? 'en' : ''}
        </div>
        <div className="text-right">
          {project.enddatum ? (
            <time className={`text-xs font-opensans ${isExpired(project) ? 'text-red-400' : 'text-muted'}`}>
              bis {new Date(project.enddatum).toLocaleDateString('de-AT')}
            </time>
          ) : (
            <time className="text-muted text-xs font-opensans">
              {new Date(project.created_at).toLocaleDateString('de-AT')}
            </time>
          )}
        </div>
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
