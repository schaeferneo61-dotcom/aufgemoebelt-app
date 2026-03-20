import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'
import { AddProductModal } from '../components/AddProductModal'
import { exportProjectToExcel } from '../lib/excel'
import type { Project, ProjectItem, Product } from '../types'

type ItemWithProduct = ProjectItem & { product: Product }

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin, profile } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [items, setItems] = useState<ItemWithProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editMenge, setEditMenge] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)

    const [{ data: proj }, { data: itemData }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase
        .from('project_items')
        .select('*, product:products(*)')
        .eq('project_id', id)
        .order('created_at'),
    ])

    setProject(proj as Project | null)
    setItems((itemData as ItemWithProduct[]) ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()

    const channel = supabase
      .channel(`project-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_items', filter: `project_id=eq.${id}` },
        load,
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id, load])

  const deleteItem = async (itemId: string) => {
    setDeletingId(itemId)
    await supabase.from('project_items').delete().eq('id', itemId)
    setDeletingId(null)
    load()
  }

  const saveEditMenge = async (itemId: string) => {
    const n = parseFloat(editMenge)
    if (!isNaN(n) && n > 0) {
      await supabase.from('project_items').update({ menge: n }).eq('id', itemId)
    }
    setEditingItem(null)
    load()
  }

  const handleExport = () => {
    if (!project) return
    exportProjectToExcel({ project, items, creatorName: profile?.name ?? undefined })
  }

  // Gesamtwert berechnen
  const totalVK = items.reduce((sum, i) => sum + i.menge * (i.product?.vk_preis ?? 0), 0)
  const totalEK = items.reduce((sum, i) => sum + i.menge * (i.product?.ek_preis ?? 0), 0)

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-black">
        <Header />
        <main className="max-w-6xl mx-auto px-4 pt-24 pb-16 text-center">
          <p className="text-muted font-opensans">Projekt nicht gefunden.</p>
          <Link to="/" className="text-white underline text-sm font-opensans mt-4 block">← Zurück</Link>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black">
      <Header />
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-16">

        {/* Breadcrumb */}
        <Link to="/" className="text-muted text-xs font-raleway uppercase tracking-widest hover:text-white transition-colors">
          ← Alle Projekte
        </Link>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mt-4 mb-10 border-b border-border pb-8">
          <div>
            <h1 className="font-raleway font-semibold text-white text-3xl uppercase tracking-widest">
              {project.name}
            </h1>
            {project.beschreibung && (
              <p className="text-muted font-opensans text-sm mt-1">{project.beschreibung}</p>
            )}
            <p className="text-muted font-opensans text-xs mt-2">
              Status: <span className="text-white">{project.status.charAt(0).toUpperCase() + project.status.slice(1)}</span>
              {' · '}
              Erstellt: <span className="text-white">{new Date(project.created_at).toLocaleDateString('de-AT')}</span>
            </p>
          </div>
          <div className="flex gap-3 flex-wrap self-start sm:self-auto">
            {isAdmin && (
              <button
                onClick={handleExport}
                className="border border-border text-white px-5 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
              >
                Excel Export
              </button>
            )}
            <button
              onClick={() => setAddOpen(true)}
              className="bg-white text-black px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors"
            >
              + Produkt hinzufügen
            </button>
          </div>
        </div>

        {/* Positionen */}
        {items.length === 0 ? (
          <div className="border border-border p-16 text-center">
            <p className="text-muted font-opensans text-sm mb-4">
              Noch keine Produkte in diesem Projekt.
            </p>
            <button
              onClick={() => setAddOpen(true)}
              className="border border-white text-white px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
            >
              Erstes Produkt hinzufügen
            </button>
          </div>
        ) : (
          <>
            {/* Tabellen-Header (Desktop) */}
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 border-b border-border text-xs font-raleway uppercase tracking-widest text-muted mb-0">
              <span>Produkt</span>
              <span>Menge</span>
              <span>EK netto</span>
              <span>VK netto</span>
              <span>Gesamt VK</span>
              <span></span>
            </div>

            {/* Items */}
            <div className="divide-y divide-border border border-border border-t-0">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isAdmin={isAdmin}
                  deletingId={deletingId}
                  editingItem={editingItem}
                  editMenge={editMenge}
                  onDelete={deleteItem}
                  onEditStart={(id, menge) => { setEditingItem(id); setEditMenge(String(menge)) }}
                  onEditSave={saveEditMenge}
                  onEditCancel={() => setEditingItem(null)}
                  onEditMengeChange={setEditMenge}
                />
              ))}
            </div>

            {/* Summen */}
            <div className="border border-border border-t-0 bg-surface px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-end gap-4">
              {isAdmin && (
                <div className="text-xs font-opensans text-muted">
                  EK gesamt: <span className="text-white font-medium">€ {totalEK.toFixed(2)}</span>
                </div>
              )}
              <div className="text-sm font-raleway text-muted uppercase tracking-widest">
                VK gesamt:{' '}
                <span className="text-white font-semibold text-base">
                  € {totalVK.toFixed(2)}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Echtzeit-Hinweis */}
        <div className="mt-8 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <p className="text-xs text-muted font-opensans">
            Echtzeit-Sync aktiv – Änderungen sind sofort für alle sichtbar
          </p>
        </div>
      </main>

      <AddProductModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={project.id}
        onAdded={load}
        existingProductIds={items.map((i) => i.product_id)}
      />
    </div>
  )
}

// ── Item-Zeile ───────────────────────────────────────────────

function ItemRow({
  item,
  isAdmin,
  deletingId,
  editingItem,
  editMenge,
  onDelete,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditMengeChange,
}: {
  item: ItemWithProduct
  isAdmin: boolean
  deletingId: string | null
  editingItem: string | null
  editMenge: string
  onDelete: (id: string) => void
  onEditStart: (id: string, menge: number) => void
  onEditSave: (id: string) => void
  onEditCancel: () => void
  onEditMengeChange: (v: string) => void
}) {
  const isEditing = editingItem === item.id
  const gesamtVK = item.menge * (item.product?.vk_preis ?? 0)

  return (
    <div className="px-4 py-4 hover:bg-surface transition-colors">
      {/* Mobile Layout */}
      <div className="md:hidden space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-opensans text-sm text-white font-medium truncate">{item.product?.produkt}</p>
            <p className="text-xs text-muted font-opensans">
              {[item.product?.staerke_mm && `${item.product.staerke_mm} mm`, item.product?.masse_mm].filter(Boolean).join(' · ')}
            </p>
            {item.notiz && <p className="text-xs text-muted font-opensans italic mt-0.5">{item.notiz}</p>}
          </div>
          {(isAdmin || true) && (
            <button
              onClick={() => onDelete(item.id)}
              disabled={deletingId === item.id}
              className="text-muted hover:text-red-400 transition-colors text-lg leading-none shrink-0"
            >
              ×
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs font-opensans text-muted">
          <span>Menge: <span className="text-white">{item.menge}</span></span>
          {item.product?.vk_preis !== null && (
            <span>VK gesamt: <span className="text-white">€ {gesamtVK.toFixed(2)}</span></span>
          )}
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 items-center">
        <div className="min-w-0">
          <p className="font-opensans text-sm text-white font-medium truncate">{item.product?.produkt}</p>
          <p className="text-xs text-muted font-opensans">
            {[
              item.product?.staerke_mm && `${item.product.staerke_mm} mm`,
              item.product?.masse_mm,
              item.product?.haendler,
            ].filter(Boolean).join(' · ')}
          </p>
          {item.notiz && <p className="text-xs text-muted font-opensans italic mt-0.5">{item.notiz}</p>}
        </div>

        {/* Menge editierbar */}
        <div>
          {isEditing ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={editMenge}
                onChange={(e) => onEditMengeChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onEditSave(item.id); if (e.key === 'Escape') onEditCancel() }}
                className="w-16 bg-transparent border border-white text-white px-2 py-1 text-xs font-opensans outline-none"
                autoFocus
              />
              <button onClick={() => onEditSave(item.id)} className="text-green-400 text-xs hover:text-green-300">✓</button>
              <button onClick={onEditCancel} className="text-muted text-xs hover:text-white">✕</button>
            </div>
          ) : (
            <button
              onClick={() => onEditStart(item.id, item.menge)}
              className="font-opensans text-sm text-white hover:underline"
              title="Menge bearbeiten"
            >
              {item.menge}
            </button>
          )}
        </div>

        <span className="font-opensans text-sm text-muted">
          {item.product?.ek_preis !== null ? `€ ${item.product!.ek_preis!.toFixed(2)}` : '–'}
        </span>
        <span className="font-opensans text-sm text-muted">
          {item.product?.vk_preis !== null ? `€ ${item.product!.vk_preis!.toFixed(2)}` : '–'}
        </span>
        <span className="font-opensans text-sm text-white font-medium">
          {item.product?.vk_preis !== null ? `€ ${gesamtVK.toFixed(2)}` : '–'}
        </span>

        <button
          onClick={() => onDelete(item.id)}
          disabled={deletingId === item.id}
          className="text-muted hover:text-red-400 transition-colors text-xl leading-none"
          title="Entfernen"
        >
          ×
        </button>
      </div>
    </div>
  )
}
