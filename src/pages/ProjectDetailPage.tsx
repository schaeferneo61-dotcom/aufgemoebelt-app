import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'
import { AddProductModal } from '../components/AddProductModal'
import { exportProjectToExcel } from '../lib/excel'
import { logLagerBewegung } from '../lib/lager'
import { getQueueForProject, removeFromQueue } from '../lib/offlineQueue'
import type { Project, ProjectItem, Product } from '../types'

type ItemWithProduct = ProjectItem & { product: Product; _offline?: boolean }

function canEdit(item: ItemWithProduct, userId: string | undefined, isAdminOrProjektleiter: boolean): boolean {
  if (item._offline) return true // Offline-Items können immer entfernt werden
  if (isAdminOrProjektleiter) return true
  if (!userId || item.hinzugefuegt_von !== userId) return false
  return Date.now() - new Date(item.created_at).getTime() < 10 * 60 * 1000
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin, isAdminOrProjektleiter, profile, user } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [items, setItems] = useState<ItemWithProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editMenge, setEditMenge] = useState('')
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  const load = useCallback(async (showSpinner = false) => {
    if (!id) return
    if (showSpinner) setLoading(true)

    const [{ data: proj }, { data: itemData }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase
        .from('project_items')
        .select('*, product:products(*)')
        .eq('project_id', id)
        .order('created_at'),
    ])

    setProject(proj as Project | null)

    // Offline-Buchungen aus lokalem Speicher hinzufügen
    const onlineItems = (itemData as ItemWithProduct[]) ?? []
    const pending = getQueueForProject(id).map(q => ({
      id: q.id,
      project_id: q.projectId,
      product_id: q.productId,
      product_name: q.productName,
      product_kategorie: q.productKategorie,
      menge: q.menge,
      notiz: q.notiz,
      hinzugefuegt_von: q.userId,
      created_at: q.createdAt,
      updated_at: q.createdAt,
      product: q.product,
      _offline: true,
    } as ItemWithProduct))

    setItems([...onlineItems, ...pending])
    if (showSpinner) setLoading(false)
  }, [id])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
    const channel = supabase
      .channel(`project-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_items', filter: `project_id=eq.${id}` },
        () => load(false),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, load])

  // Bug 1 Fix: Globales Event von App.tsx empfangen – Seite nach Sync neu laden
  useEffect(() => {
    const handleQueueUpdated = (e: Event) => {
      const { synced, rejected } = (e as CustomEvent<{ synced: number; rejected: string[] }>).detail
      load(false)
      if (rejected.length > 0) {
        setSyncNote(
          `${synced > 0 ? `${synced} Buchung(en) synchronisiert. ` : ''}` +
          `${rejected.length} Ware(n) nicht mehr vorhanden und wurden verworfen: ${rejected.join(', ')}`
        )
      }
    }
    window.addEventListener('offlineQueueUpdated', handleQueueUpdated)
    return () => window.removeEventListener('offlineQueueUpdated', handleQueueUpdated)
  }, [load])

  // Online-Status reaktiv halten, damit der Echtzeit-Indikator korrekt erscheint/verschwindet
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

  const deleteItem = async (itemId: string) => {
    const isOffline = items.find(i => i.id === itemId)?._offline
    if (isOffline) {
      removeFromQueue(itemId)
      setItems(prev => prev.filter(i => i.id !== itemId))
      window.dispatchEvent(new CustomEvent('offlineQueueUpdated', { detail: { synced: 0, rejected: [] } }))
      return
    }
    if (!window.confirm('Position wirklich entfernen?')) return
    setDeletingId(itemId)
    const backup = items.find(i => i.id === itemId)
    setItems(prev => prev.filter(i => i.id !== itemId)) // optimistisch entfernen
    const { error } = await supabase.from('project_items').delete().eq('id', itemId)
    if (error) {
      // Wiederherstellen wenn DB-Fehler
      if (backup) setItems(prev => [...prev, backup].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))
      alert('Fehler beim Entfernen: ' + error.message)
    } else if (backup) {
      // Audit-Log: Ware wieder eingebucht
      await logLagerBewegung({
        product_id: backup.product_id,
        product_name: backup.product?.produkt ?? backup.product_name ?? '(unbekannt)',
        project_id: id!,
        project_name: project?.name ?? '',
        aktion: 'eingebucht',
        menge_delta: backup.menge,
        user_id: user?.id ?? null,
        user_name: profile?.name ?? null,
      })
    }
    setDeletingId(null)
  }

  const saveEditMenge = async (itemId: string) => {
    const n = parseFloat(editMenge)
    if (isNaN(n) || n <= 0) {
      setEditingItem(null)
      return
    }
    const oldItem = items.find(i => i.id === itemId)
    // No-op: gleiche Menge → kein DB-Schreibzugriff, kein Audit-Eintrag
    if (oldItem && oldItem.menge === n) {
      setEditingItem(null)
      return
    }
    const { error } = await supabase.from('project_items').update({ menge: n }).eq('id', itemId)
    if (error) {
      alert('Fehler beim Speichern: ' + error.message)
      return // Edit-Zustand offen lassen bei Fehler
    }
    // Audit-Log: Mengenänderung → delta = neue Menge - alte Menge (negativ = mehr verbraucht)
    if (oldItem) {
      const delta = -(n - oldItem.menge) // negative delta = mehr aus Lager
      await logLagerBewegung({
        product_id: oldItem.product_id,
        product_name: oldItem.product?.produkt ?? oldItem.product_name ?? '(unbekannt)',
        project_id: id!,
        project_name: project?.name ?? '',
        aktion: 'menge_geaendert',
        menge_delta: delta,
        user_id: user?.id ?? null,
        user_name: profile?.name ?? null,
      })
    }
    setEditingItem(null)
  }

  const [exporting, setExporting] = useState(false)
  // „Neue Änderungen" nur in dieser Session zeigen (nach einem Export in dieser Session)
  const [sessionExportTime, setSessionExportTime] = useState<number | null>(null)
  // Bug 2 Fix: Offline-Items aus Änderungserkennung ausschließen
  const onlineItems = items.filter(i => !i._offline)
  const hasNewChanges = sessionExportTime !== null && onlineItems.length > 0 &&
    Math.max(...onlineItems.map(i => new Date(i.updated_at ?? i.created_at).getTime())) > sessionExportTime

  const handleExport = async () => {
    if (!project) return
    setExporting(true)
    try {
      // Nur gespeicherte Items exportieren – offline-ausstehende sind noch nicht in der DB
      await exportProjectToExcel({ project, items: items.filter(i => !i._offline), creatorName: profile?.name ?? undefined })
      setSessionExportTime(Date.now())
    } catch (e) {
      alert('Export fehlgeschlagen: ' + String(e))
    } finally {
      setExporting(false)
    }
  }

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
        <main className="max-w-screen-lg mx-auto px-4 text-center"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 5rem)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)' }}>
          <p className="text-muted font-opensans">Projekt nicht gefunden.</p>
          <Link to="/" className="text-white underline text-sm font-opensans mt-4 block">← Zurück</Link>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black">
      <Header />
      <main
        className="max-w-screen-lg mx-auto px-4"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 4rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)',
        }}
      >

        {/* Breadcrumb */}
        <div className="mt-6">
          <Link to="/" className="text-muted text-xs font-raleway uppercase tracking-widest hover:text-white transition-colors">
            ← Warenwirtschaft
          </Link>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mt-3 mb-8 border-b border-border pb-6">
          <div>
            <h1 className="font-raleway font-semibold text-white text-2xl uppercase tracking-widest">
              {project.name}
            </h1>
            {project.beschreibung && (
              <p className="text-muted font-opensans text-sm mt-1">{project.beschreibung}</p>
            )}
            {isAdminOrProjektleiter && (
              <p className="text-muted font-opensans text-xs mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>Status: <span className="text-white">{project.status.charAt(0).toUpperCase() + project.status.slice(1)}</span></span>
                {project.enddatum && (
                  <span>Enddatum: <span className="text-white">{new Date(project.enddatum).toLocaleDateString('de-AT')}</span></span>
                )}
                <span>Erstellt: <span className="text-white">{new Date(project.created_at).toLocaleDateString('de-AT')}</span></span>
                <span>Typ: <span className="text-white capitalize">{project.typ ?? 'Extern'}</span></span>
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap self-start sm:self-auto">
            {isAdminOrProjektleiter && (
              <button
                onClick={handleExport}
                disabled={exporting}
                className="relative border border-border text-white px-4 py-2.5 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors disabled:opacity-50"
              >
                {exporting ? 'Exportiert…' : 'Excel Export'}
                {hasNewChanges && (
                  <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-yellow-400 rounded-full" title="Neue Änderungen seit letztem Export" />
                )}
              </button>
            )}
            <button
              onClick={() => setAddOpen(true)}
              className="bg-white text-black px-5 py-2.5 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors"
            >
              + Ware
            </button>
          </div>
        </div>

        {/* Sync-Hinweis nach Reconnect */}
        {syncNote && (
          <div className="mb-4 px-4 py-3 border border-yellow-400/30 text-yellow-400 text-xs font-opensans flex justify-between items-start gap-3">
            <span>{syncNote}</span>
            <button onClick={() => setSyncNote(null)} className="shrink-0 text-yellow-400 hover:text-white">×</button>
          </div>
        )}

        {/* Positionen */}
        {items.length === 0 ? (
          <div className="border border-border p-12 text-center">
            <p className="text-muted font-opensans text-sm mb-4">
              Noch keine Waren in diesem Projekt.
            </p>
            <button
              onClick={() => setAddOpen(true)}
              className="border border-white text-white px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
            >
              Erste Ware hinzufügen
            </button>
          </div>
        ) : (
          <>
            {/* Tabellen-Header (Desktop) */}
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 border-b border-border text-xs font-raleway uppercase tracking-widest text-muted">
              <span>Ware</span>
              <span>Menge</span>
              <span>EK netto</span>
              <span>VK netto</span>
              <span>Gesamt VK</span>
              <span></span>
            </div>

            <div className="divide-y divide-border border border-border border-t-0">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  canEditItem={canEdit(item, user?.id, isAdminOrProjektleiter)}
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
              {isAdminOrProjektleiter && (
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

        {/* Echtzeit-Hinweis – nur online anzeigen */}
        {isOnline && (
          <div className="mt-6 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <p className="text-xs text-muted font-opensans">
              Echtzeit-Sync aktiv – Änderungen sofort für alle sichtbar
            </p>
          </div>
        )}
      </main>

      <AddProductModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={project.id}
        projectName={project.name}
        onAdded={load}
        existingProductIds={items.map((i) => i.product_id)}
      />
    </div>
  )
}

// ── Item-Zeile ───────────────────────────────────────────────

function ItemRow({
  item,
  canEditItem,
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
  canEditItem: boolean
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
    <div className={`px-4 py-4 hover:bg-surface transition-colors ${item._offline ? 'opacity-70' : ''}`}>
      {/* Mobile Layout */}
      <div className="md:hidden space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-opensans text-sm text-white font-medium">{item.product?.produkt ?? item.product_name ?? '(Ware nicht mehr vorhanden)'}</p>
              {item._offline && <span className="text-[10px] font-raleway uppercase tracking-widest text-yellow-400 border border-yellow-400/40 px-1.5 py-0.5">Ausstehend</span>}
            </div>
            <p className="text-xs text-muted font-opensans mt-0.5">
              {[item.product?.staerke_mm && `${item.product.staerke_mm} mm`, item.product?.masse_mm].filter(Boolean).join(' · ')}
            </p>
            {item.notiz && <p className="text-xs text-muted font-opensans italic mt-0.5">{item.notiz}</p>}
          </div>
          {canEditItem && (
            <button
              onClick={() => onDelete(item.id)}
              disabled={deletingId === item.id}
              className="text-muted hover:text-red-400 transition-colors shrink-0 p-2 -mr-2 text-xl leading-none"
              aria-label="Entfernen"
            >
              ×
            </button>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs font-opensans text-muted">
          {/* Menge auf Mobile auch editierbar */}
          {item._offline ? (
            <span>Menge: <span className="text-white">{item.menge}</span></span>
          ) : isEditing ? (
            <div className="flex items-center gap-2">
              <span>Menge:</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={editMenge}
                onChange={(e) => onEditMengeChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onEditSave(item.id); if (e.key === 'Escape') onEditCancel() }}
                className="w-20 bg-transparent border border-white text-white px-2 py-1.5 text-sm font-opensans outline-none"
                autoFocus
              />
              <button onClick={() => onEditSave(item.id)} className="text-green-400 text-base p-2 min-w-[36px] min-h-[36px] flex items-center justify-center">✓</button>
              <button onClick={onEditCancel} className="text-muted text-base p-2 min-w-[36px] min-h-[36px] flex items-center justify-center hover:text-white">✕</button>
            </div>
          ) : (
            <button
              onClick={() => canEditItem && onEditStart(item.id, item.menge)}
              className={canEditItem ? 'hover:underline' : ''}
            >
              Menge: <span className="text-white">{item.menge}</span>
              {canEditItem && <span className="text-muted ml-1">✎</span>}
            </button>
          )}
          {item.product?.vk_preis !== null && (
            <span>VK gesamt: <span className="text-white">€ {gesamtVK.toFixed(2)}</span></span>
          )}
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-opensans text-sm text-white font-medium truncate">{item.product?.produkt ?? item.product_name ?? '(Ware nicht mehr vorhanden)'}</p>
            {item._offline && <span className="shrink-0 text-[10px] font-raleway uppercase tracking-widest text-yellow-400 border border-yellow-400/40 px-1.5 py-0.5">Ausstehend</span>}
          </div>
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
          {item._offline ? (
            <span className="font-opensans text-sm text-white">{item.menge}</span>
          ) : isEditing ? (
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
          ) : canEditItem ? (
            <button
              onClick={() => onEditStart(item.id, item.menge)}
              className="font-opensans text-sm text-white hover:underline"
              title="Menge bearbeiten"
            >
              {item.menge} <span className="text-muted text-xs">✎</span>
            </button>
          ) : (
            <span className="font-opensans text-sm text-white">{item.menge}</span>
          )}
        </div>

        <span className="font-opensans text-sm text-muted">
          {item.product?.ek_preis != null ? `€ ${item.product.ek_preis.toFixed(2)}` : '–'}
        </span>
        <span className="font-opensans text-sm text-muted">
          {item.product?.vk_preis != null ? `€ ${item.product.vk_preis.toFixed(2)}` : '–'}
        </span>
        <span className="font-opensans text-sm text-white font-medium">
          {item.product?.vk_preis != null ? `€ ${gesamtVK.toFixed(2)}` : '–'}
        </span>

        {canEditItem ? (
          <button
            onClick={() => onDelete(item.id)}
            disabled={deletingId === item.id}
            className="text-muted hover:text-red-400 transition-colors text-xl leading-none p-1"
            title="Entfernen"
          >
            ×
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
