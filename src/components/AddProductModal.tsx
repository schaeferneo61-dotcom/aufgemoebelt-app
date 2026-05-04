import { useState, useEffect, useRef } from 'react'
import { Modal } from './Modal'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logLagerBewegung } from '../lib/lager'
import { addToQueue } from '../lib/offlineQueue'
import type { Product } from '../types'

const KATEGORIEN_REIHENFOLGE = [
  'Holz: Latten, Staffeln & Platten',
  'Metall & Kunststoff - Plattenware',
  'Stoffe',
  'Folien',
  'Stahl',
  'Alu',
]

// Modul-level Cache — wird NICHT bei jedem Modal-Open neu geladen
let _productsCache: Product[] = []
let _cacheTimestamp = 0
const CACHE_TTL = 3 * 60 * 1000 // 3 Minuten

// Nach einem Excel-Import aufrufen damit das Modal sofort die neuen Produkte zeigt
export function clearProductsCache() {
  _productsCache = []
  _cacheTimestamp = 0
}

// Fuzzy-Suche: Groß-/Kleinschreibung egal, Umlaute egal, kleine Tippfehler tolerant
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
  // Subsequenz-Match für Tippfehler
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  projectName: string
  onAdded: () => void
  existingProductIds?: string[]
}

type View = 'suche' | 'kategorien' | 'produkte'

export function AddProductModal({ open, onClose, projectId, projectName, onAdded, existingProductIds: _existingProductIds = [] }: Props) {
  const { user, profile } = useAuth()
  const [products, setProducts] = useState<Product[]>(_productsCache)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [menge, setMenge] = useState('1')
  const [notiz, setNotiz] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('suche')
  const [selectedKategorie, setSelectedKategorie] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Produkte laden
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
    }
  }, [open])

  async function loadProducts() {
    const now = Date.now()
    if (_productsCache.length > 0 && now - _cacheTimestamp < CACHE_TTL) {
      setProducts(_productsCache)
      return
    }
    setLoading(true)
    const { data, error } = await supabase.from('products').select('*').order('produkt')
    if (!error && data) {
      _productsCache = data as Product[]
      _cacheTimestamp = Date.now()
    }
    // Bei Fehler: Cache verwenden (ggf. leer) – kein Absturz
    setProducts(_productsCache)
    setLoading(false)
  }

  // Fuzzy-Filter über alle Produktfelder
  const filtered = products.filter((p) =>
    fuzzyMatch(p.produkt, search) ||
    fuzzyMatch(p.haendler ?? '', search) ||
    fuzzyMatch(p.masse_mm ?? '', search) ||
    fuzzyMatch(p.kategorie ?? '', search) ||
    fuzzyMatch(p.staerke_mm ?? '', search)
  )

  // Kategorien aus DB + immer die vordefinierten anzeigen
  const kategorienAusDB = Array.from(
    new Set(products.map((p) => p.kategorie).filter((k): k is string => !!k))
  )

  const kategorien = [
    // Vordefinierte Kategorien nur zeigen wenn mind. 1 Produkt vorhanden
    ...KATEGORIEN_REIHENFOLGE.filter((kat) =>
      products.some((p) => (p.kategorie ?? 'Sonstige') === kat)
    ),
    ...kategorienAusDB.filter((k) => !KATEGORIEN_REIHENFOLGE.includes(k)).sort(),
    ...(products.some((p) => !p.kategorie) ? ['Sonstige'] : []),
  ]

  const produkteInKategorie = products.filter(
    (p) => (p.kategorie ?? 'Sonstige') === selectedKategorie
  )

  const mengeNum = parseFloat(menge)
  const mengeValid = !isNaN(mengeNum) && mengeNum > 0

  const gesamtpreis = selected?.vk_preis != null && mengeValid
    ? selected.vk_preis * mengeNum
    : null

  const handleAdd = async () => {
    if (!selected) return
    if (!mengeValid) {
      setError('Menge muss eine positive Zahl sein.')
      return
    }

    setSaving(true)
    setError(null)

    // OFFLINE: Buchung in lokale Warteschlange – wird synchronisiert wenn wieder online
    if (!navigator.onLine) {
      addToQueue({
        id: crypto.randomUUID(),
        projectId,
        projectName,
        productId: selected.id,
        productName: selected.produkt,
        productKategorie: selected.kategorie ?? null,
        product: selected,
        menge: mengeNum,
        notiz: notiz.trim() || null,
        userId: user?.id ?? null,
        userName: profile?.name ?? null,
        createdAt: new Date().toISOString(),
      })
      setSaving(false)
      onAdded()
      onClose()
      return
    }

    // ONLINE: Normal einfügen
    const { error: insertError } = await supabase.from('project_items').insert({
      project_id: projectId,
      product_id: selected.id,
      product_name: selected.produkt,
      product_kategorie: selected.kategorie ?? null,
      menge: mengeNum,
      notiz: notiz.trim() || null,
      hinzugefuegt_von: user?.id ?? null,
    })

    if (insertError) {
      setError(insertError.message)
    } else {
      await logLagerBewegung({
        product_id: selected.id,
        product_name: selected.produkt,
        project_id: projectId,
        project_name: projectName,
        aktion: 'ausgebucht',
        menge_delta: -mengeNum,
        user_id: user?.id ?? null,
        user_name: profile?.name ?? null,
      })
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
    <Modal open={open} onClose={onClose} title="Ware hinzufügen" maxWidth="max-w-2xl">
      <div className="space-y-3">

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
              placeholder="Ware suchen (Tippfehler & Umlaute egal)…"
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
                    ? 'Keine Waren. Bitte Excel im Admin-Bereich hochladen.'
                    : `Keine Treffer für „${search}".`}
                </p>
              ) : (
                filtered.map((p) => (
                  <ProductRow key={p.id} product={p} onSelect={selectProduct} />
                ))
              )}
            </div>
            {search && filtered.length > 0 && (
              <p className="text-xs text-muted font-opensans text-right">
                {filtered.length} Treffer
              </p>
            )}
          </>
        )}

        {/* LAGER – Kategorienübersicht */}
        {view === 'kategorien' && (
          <>
            <div className="border border-border overflow-y-auto" style={{ maxHeight: '300px' }}>
              {loading ? (
                <div className="flex items-center justify-center h-20">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                kategorien.map((kat) => {
                  const alleInKat = products.filter((p) => (p.kategorie ?? 'Sonstige') === kat)
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
                        {alleInKat.length} Ware{alleInKat.length !== 1 ? 'n' : ''}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </>
        )}

        {/* LAGER – Produkte einer Kategorie */}
        {view === 'produkte' && selectedKategorie && (
          <>
            <button
              onClick={() => setView('kategorien')}
              className="text-xs text-muted font-raleway uppercase tracking-widest hover:text-white transition-colors"
            >
              ← Zurück zu Kategorien
            </button>
            <p className="text-xs text-white font-raleway uppercase tracking-widest">{selectedKategorie}</p>
            <div className="border border-border overflow-y-auto" style={{ maxHeight: '300px' }}>
              {produkteInKategorie.length === 0 ? (
                <p className="text-muted text-sm font-opensans p-4 text-center">
                  Keine Waren in dieser Kategorie.
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
            <div className="flex gap-3">
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
                <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2 whitespace-nowrap">
                  VK Gesamt
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

            {selected.vk_preis !== null && mengeValid && (
              <p className="text-xs text-muted font-opensans">
                Einzelpreis: € {selected.vk_preis.toFixed(2)} · Menge: {mengeNum}
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
            disabled={saving}
            className="flex-1 border border-border text-white py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors disabled:opacity-40"
          >
            Abbrechen
          </button>
          <button
            onClick={handleAdd}
            disabled={!selected || !mengeValid || saving}
            className="flex-1 bg-white text-black py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40"
          >
            {saving ? 'Wird gespeichert...' : 'Hinzufügen'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface ProductRowProps {
  product: Product
  onSelect: (p: Product) => void
}

function ProductRow({ product: p, onSelect }: ProductRowProps) {
  return (
    <button
      onClick={() => onSelect(p)}
      className="w-full text-left px-4 py-3 border-b border-border last:border-b-0 transition-colors group hover:bg-white hover:text-black cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-opensans text-sm font-medium truncate text-white group-hover:text-black">
            {p.produkt}
          </p>
          <p className="text-xs font-opensans mt-0.5 text-muted group-hover:text-black/60">
            {[p.staerke_mm && `${p.staerke_mm} mm`, p.masse_mm, p.haendler]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        {p.vk_preis !== null && (
          <p className="text-sm font-opensans text-white group-hover:text-black shrink-0">
            € {p.vk_preis.toFixed(2)}
          </p>
        )}
      </div>
    </button>
  )
}
