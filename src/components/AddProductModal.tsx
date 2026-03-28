import { useState, useEffect, useRef } from 'react'
import { Modal } from './Modal'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { parseProductExcelFromUrl } from '../lib/excel'
import type { Product } from '../types'

const STORAGE_BUCKET = 'produktliste'
const STORAGE_FILE = 'produktliste.xlsx'

const KATEGORIEN_REIHENFOLGE = [
  'Holz: Latten, Staffeln & Platten',
  'Metall & Kunststoff - Plattenware',
  'Stoffe',
  'Folien',
  'Stahl',
  'Alu',
]

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  onAdded: () => void
  existingProductIds?: string[]
}

type View = 'suche' | 'kategorien' | 'produkte'

export function AddProductModal({ open, onClose, projectId, onAdded, existingProductIds = [] }: Props) {
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [menge, setMenge] = useState('1')
  const [notiz, setNotiz] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('suche')
  const [selectedKategorie, setSelectedKategorie] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      loadProducts()
      setView('suche')
      setTimeout(() => searchRef.current?.focus(), 100)
    } else {
      setSearch('')
      setSelected(null)
      setMenge('1')
      setNotiz('')
      setError(null)
      setView('suche')
      setSelectedKategorie(null)
      setSyncStatus(null)
    }
  }, [open])

  async function loadProducts() {
    setLoading(true)
    setSyncStatus(null)

    // Versuche immer zuerst die aktuelle Excel aus Supabase Storage zu lesen
    try {
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(STORAGE_FILE)
      const publicUrl = urlData.publicUrl

      setSyncStatus('Lade aktuelle Produktliste...')
      const parsed = await parseProductExcelFromUrl(publicUrl)

      if (parsed.length > 0) {
        // DB im Hintergrund aktualisieren
        supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000').then(() => {
          supabase.from('products').insert(parsed).then(() => {
            supabase.from('products').select('*').order('produkt').then(({ data }) => {
              if (data && data.length > 0) setProducts(data as Product[])
            })
          })
        })
        // Sofort mit geparsten Daten anzeigen
        setProducts(parsed.map((p, i) => ({ ...p, id: `storage-${i}`, created_at: '', updated_at: '' })))
        setSyncStatus(null)
        setLoading(false)
        return
      }
    } catch {
      // Kein Storage-File vorhanden → Datenbank verwenden
    }

    setSyncStatus(null)
    const { data } = await supabase.from('products').select('*').order('produkt')
    setProducts((data as Product[]) ?? [])
    setLoading(false)
  }

  const filtered = products.filter((p) =>
    p.produkt.toLowerCase().includes(search.toLowerCase()) ||
    (p.haendler ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.masse_mm ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.kategorie ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Kategorien aus DB + immer die vordefinierten anzeigen
  const kategorienAusDB = Array.from(
    new Set(products.map((p) => p.kategorie).filter((k): k is string => !!k))
  )

  const kategorien = [
    ...KATEGORIEN_REIHENFOLGE,
    ...kategorienAusDB.filter((k) => !KATEGORIEN_REIHENFOLGE.includes(k)).sort(),
    ...(products.some((p) => !p.kategorie) ? ['Sonstige'] : []),
  ]

  const produkteInKategorie = products.filter(
    (p) => (p.kategorie ?? 'Sonstige') === selectedKategorie
  )

  const gesamtpreis = selected?.vk_preis != null
    ? selected.vk_preis * (parseFloat(menge) || 1)
    : null

  const handleAdd = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)

    // Falls temporäre ID → echte ID aus DB holen
    let productId = selected.id
    if (productId.startsWith('temp-')) {
      const { data } = await supabase
        .from('products')
        .select('id')
        .eq('produkt', selected.produkt)
        .limit(1)
        .single()
      if (data) productId = data.id
    }

    const { error } = await supabase.from('project_items').insert({
      project_id: projectId,
      product_id: productId,
      menge: parseFloat(menge) || 1,
      notiz: notiz.trim() || null,
      hinzugefuegt_von: user?.id ?? null,
    })

    if (error) {
      setError(error.message)
    } else {
      onAdded()
      onClose()
    }
    setSaving(false)
  }

  const selectProduct = (p: Product) => {
    setSelected(p)
    setSearch(p.produkt)
    setView('suche')
  }

  return (
    <Modal open={open} onClose={onClose} title="Produkt hinzufügen" maxWidth="max-w-2xl">
      <div className="space-y-3">

        {/* Sync-Status */}
        {syncStatus && (
          <p className="text-xs text-muted font-opensans flex items-center gap-2">
            <span className="inline-block w-3 h-3 border border-muted border-t-transparent rounded-full animate-spin" />
            {syncStatus}
          </p>
        )}

        {/* Modus-Tabs */}
        {!selected && (
          <div className="flex gap-1 border border-border p-1">
            <button
              onClick={() => setView('suche')}
              className={`flex-1 py-2 font-raleway text-xs uppercase tracking-widest transition-colors ${
                view === 'suche' ? 'bg-white text-black' : 'text-muted hover:text-white'
              }`}
            >
              Suche
            </button>
            <button
              onClick={() => { setView('kategorien'); setSelectedKategorie(null) }}
              className={`flex-1 py-2 font-raleway text-xs uppercase tracking-widest transition-colors ${
                view === 'kategorien' || view === 'produkte' ? 'bg-white text-black' : 'text-muted hover:text-white'
              }`}
            >
              Lager
            </button>
          </div>
        )}

        {/* SUCHE */}
        {view === 'suche' && !selected && (
          <>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelected(null) }}
              placeholder="Produkt suchen..."
              className="w-full bg-transparent border border-border text-white px-4 py-3 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
            />
            <div className="border border-border overflow-y-auto" style={{ maxHeight: '260px' }}>
              {loading ? (
                <div className="flex items-center justify-center h-20">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-muted text-sm font-opensans p-4 text-center">
                  {products.length === 0
                    ? 'Keine Produkte. Bitte SharePoint-Link im Admin-Bereich eintragen.'
                    : 'Keine Produkte gefunden.'}
                </p>
              ) : (
                filtered.map((p) => (
                  <ProductRow key={p.id} product={p} onSelect={selectProduct} />
                ))
              )}
            </div>
          </>
        )}

        {/* LAGER – Kategorienübersicht */}
        {view === 'kategorien' && (
          <div className="border border-border overflow-y-auto" style={{ maxHeight: '300px' }}>
            {loading ? (
              <div className="flex items-center justify-center h-20">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              kategorien.map((kat) => {
                const anzahl = products.filter(
                  (p) => (p.kategorie ?? 'Sonstige') === kat
                ).length
                return (
                  <button
                    key={kat}
                    onClick={() => { setSelectedKategorie(kat); setView('produkte') }}
                    className="w-full text-left px-4 py-3 border-b border-border last:border-b-0 hover:bg-white hover:text-black transition-colors group flex items-center justify-between"
                  >
                    <span className="font-raleway text-sm text-white group-hover:text-black tracking-wide">
                      {kat}
                    </span>
                    <span className="text-xs text-muted group-hover:text-black/60 font-opensans">
                      {anzahl} Produkt{anzahl !== 1 ? 'e' : ''}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        )}

        {/* LAGER – Produkte einer Kategorie */}
        {view === 'produkte' && selectedKategorie && (
          <>
            <button
              onClick={() => setView('kategorien')}
              className="text-xs text-muted font-raleway uppercase tracking-widest hover:text-white transition-colors"
            >
              ← {selectedKategorie}
            </button>
            <div className="border border-border overflow-y-auto" style={{ maxHeight: '260px' }}>
              {produkteInKategorie.length === 0 ? (
                <p className="text-muted text-sm font-opensans p-4 text-center">
                  Keine Produkte in dieser Kategorie.
                </p>
              ) : (
                produkteInKategorie.map((p) => (
                  <ProductRow key={p.id} product={p} onSelect={selectProduct} />
                ))
              )}
            </div>
          </>
        )}

        {/* Ausgewähltes Produkt + Details */}
        {selected && (
          <div className="border border-white p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-opensans font-medium text-white">{selected.produkt}</p>
                <p className="text-xs text-muted font-opensans mt-0.5">
                  {[
                    selected.kategorie && `Kategorie: ${selected.kategorie}`,
                    selected.staerke_mm && `Stärke: ${selected.staerke_mm} mm`,
                    selected.masse_mm && `Maße: ${selected.masse_mm}`,
                    selected.m2_lfm && `m²/Lfm: ${selected.m2_lfm}`,
                    selected.haendler && `Händler: ${selected.haendler}`,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button
                onClick={() => { setSelected(null); setSearch(''); setView('suche') }}
                className="text-muted hover:text-white text-lg leading-none shrink-0 ml-2"
              >
                ×
              </button>
            </div>

            {/* Menge + Preis */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
                  Menge
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={menge}
                  onChange={(e) => setMenge(e.target.value)}
                  className="w-full bg-transparent border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
                  VK-Preis × Menge
                </label>
                <div className="border border-border px-4 py-2.5 font-opensans text-sm">
                  {gesamtpreis !== null ? (
                    <span className="text-white font-medium">€ {gesamtpreis.toFixed(2)}</span>
                  ) : (
                    <span className="text-muted">–</span>
                  )}
                </div>
              </div>
            </div>

            {selected.vk_preis !== null && (
              <p className="text-xs text-muted font-opensans">
                Einzelpreis: € {selected.vk_preis.toFixed(2)} · Menge: {parseFloat(menge) || 1}
              </p>
            )}

            {/* Notiz */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
                Notiz (optional)
              </label>
              <input
                type="text"
                value={notiz}
                onChange={(e) => setNotiz(e.target.value)}
                placeholder="z.B. für Wand links"
                className="w-full bg-transparent border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
              />
            </div>
          </div>
        )}

        {error && <p className="text-red-400 text-xs font-opensans">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-border text-white py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleAdd}
            disabled={!selected || saving}
            className="flex-1 bg-white text-black py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40"
          >
            {saving ? 'Wird gespeichert...' : 'Hinzufügen'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ProductRow({ product: p, onSelect }: { product: Product; onSelect: (p: Product) => void }) {
  return (
    <button
      onClick={() => onSelect(p)}
      className="w-full text-left px-4 py-3 border-b border-border last:border-b-0 hover:bg-white hover:text-black transition-colors group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-opensans text-sm text-white group-hover:text-black font-medium truncate">
            {p.produkt}
          </p>
          <p className="text-xs text-muted group-hover:text-black/60 font-opensans mt-0.5">
            {[p.staerke_mm && `${p.staerke_mm} mm`, p.masse_mm, p.haendler]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="text-right shrink-0">
          {p.vk_preis !== null && (
            <p className="text-sm font-opensans text-white group-hover:text-black">
              € {p.vk_preis.toFixed(2)}
            </p>
          )}
          {p.bestand > 0 && (
            <p className="text-xs text-muted group-hover:text-black/60 font-opensans">
              Bestand: {p.bestand}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}
