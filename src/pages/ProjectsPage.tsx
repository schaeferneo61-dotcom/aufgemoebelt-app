import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'
import { CreateProjectModal } from '../components/CreateProjectModal'
import type { Project } from '../types'

const STATUS_LABELS: Record<string, string> = {
  aktiv: 'Aktiv',
  abgeschlossen: 'Abgeschlossen',
  pausiert: 'Pausiert',
}

export function ProjectsPage() {
  const { isAdmin } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'alle' | 'aktiv' | 'abgeschlossen' | 'pausiert'>('aktiv')
  const [createOpen, setCreateOpen] = useState(false)
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    const list = (data as Project[]) ?? []
    setProjects(list)

    // Zähle Items pro Projekt
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

    // Realtime: Projekte
    const channel = supabase
      .channel('projects-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_items' }, load)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [load])

  const filtered = filter === 'alle' ? projects : projects.filter((p) => p.status === filter)

  return (
    <div className="min-h-screen bg-black">
      <Header />
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-16">

        {/* Seitenkopf */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10 border-b border-border pb-8">
          <div>
            <h1 className="font-raleway font-semibold text-white text-3xl uppercase tracking-widest">
              Projekte
            </h1>
            <p className="text-muted font-opensans text-sm mt-1">
              {projects.length} Projekt{projects.length !== 1 ? 'e' : ''} gesamt
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="bg-white text-black px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            + Neues Projekt
          </button>
        </div>

        {/* Filter */}
        <div className="flex gap-1 mb-8 border border-border p-1 w-fit">
          {(['aktiv', 'pausiert', 'abgeschlossen', 'alle'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 font-raleway text-xs uppercase tracking-widest transition-colors ${
                filter === f ? 'bg-white text-black' : 'text-muted hover:text-white'
              }`}
            >
              {f === 'alle' ? 'Alle' : STATUS_LABELS[f]}
            </button>
          ))}
        </div>

        {/* Projektliste */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-border p-12 text-center">
            <p className="text-muted font-opensans text-sm">
              {projects.length === 0
                ? 'Noch keine Projekte. Erstellen Sie Ihr erstes Projekt!'
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
                isAdmin={isAdmin}
                onRefresh={load}
              />
            ))}
          </div>
        )}
      </main>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
      />
    </div>
  )
}

// ── Projekt-Karte ────────────────────────────────────────────

function ProjectCard({
  project,
  itemCount,
  isAdmin,
  onRefresh,
}: {
  project: Project
  itemCount: number
  isAdmin: boolean
  onRefresh: () => void
}) {
  const [updating, setUpdating] = useState(false)

  const cycleStatus = async () => {
    const next: Record<string, string> = {
      aktiv: 'pausiert',
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

  return (
    <div className="bg-black p-6 flex flex-col gap-4 hover:bg-surface transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/projekt/${project.id}`} className="flex-1 min-w-0">
          <h2 className="font-raleway font-semibold text-white text-base uppercase tracking-wide group-hover:underline truncate">
            {project.name}
          </h2>
          {project.beschreibung && (
            <p className="text-muted text-xs font-opensans mt-1 line-clamp-2">
              {project.beschreibung}
            </p>
          )}
        </Link>
        {isAdmin && (
          <button
            onClick={cycleStatus}
            disabled={updating}
            title="Status ändern"
            className={`text-xs font-raleway uppercase tracking-wider shrink-0 ${statusColor[project.status]} hover:text-white transition-colors`}
          >
            {STATUS_LABELS[project.status]}
          </button>
        )}
        {!isAdmin && (
          <span className={`text-xs font-raleway uppercase tracking-wider shrink-0 ${statusColor[project.status]}`}>
            {STATUS_LABELS[project.status]}
          </span>
        )}
      </div>

      <div className="border-t border-border pt-4 flex items-center justify-between">
        <div className="text-muted font-opensans text-xs">
          <span className="text-white font-medium">{itemCount}</span> Position{itemCount !== 1 ? 'en' : ''}
        </div>
        <time className="text-muted text-xs font-opensans">
          {new Date(project.created_at).toLocaleDateString('de-AT')}
        </time>
      </div>

      <Link
        to={`/projekt/${project.id}`}
        className="block border border-border text-center py-2.5 font-raleway text-xs uppercase tracking-widest text-white hover:bg-white hover:text-black transition-colors"
      >
        Öffnen →
      </Link>
    </div>
  )
}
