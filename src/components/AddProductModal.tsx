import { useState, useEffect, useRef } from 'react'
import { Modal } from './Modal'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Product } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  onAdded: () => void
  existingProductIds?: string[]
}

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
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      loadProducts()
      setTimeout(() => searchRef.current?.focus(), 100)
    } else {
      setSearch('')
      setSelected(null)
      setMenge('1')
      setNotiz('')
      setError(null)
    }
  }, [open])

  async function loadProducts() {
    setLoading(true)
    const { data } = await supabase.from('products').select('*').order('produkt')
    setProducts((data as Product[]) ?? [])
    setLoading(false)
  }

  const filtered = products.filter((p) =>
    p.produkt.toLowerCase().includes(search.toLowerCase()) ||
    (p.haendler ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.masse_mm ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const handleAdd = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)

    const { error } = await supabase.from('project_items').insert({
      project_id: projectId,
      product_id: selected.id,
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

  return (
    <Modal open={open} onClose={onClose} title="Produkt hinzufügen" maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Suche */}
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelected(null) }}
          placeholder="Produkt suchen..."
          className="w-full bg-transparent border border-border text-white px-4 py-3 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
        />

        {/* Produktliste */}
        {!selected && (
          <div className="border border-border overflow-y-auto" style={{ maxHeight: '280px' }}>
            {loading ? (
              <div className="flex items-center justify-center h-20">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-muted text-sm font-opensans p-4 text-center">
                {products.length === 0
                  ? 'Keine Produkte vorhanden. Bitte zuerst Excel importieren.'
                  : 'Keine Produkte gefunden.'}
              </p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p); setSearch(p.produkt) }}
                  className="w-full text-left px-4 py-3 border-b border-border last:border-b-0 hover:bg-white hover:text-black transition-colors group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-opensans text-sm text-white group-hover:text-black font-medium">
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
              ))
            )}
          </div>
        )}

        {/* Ausgewähltes Produkt + Details */}
        {selected && (
          <div className="border border-white p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-opensans font-medium text-white">{selected.produkt}</p>
                <p className="text-xs text-muted font-opensans mt-0.5">
                  {[selected.staerke_mm && `Stärke: ${selected.staerke_mm} mm`,
                    selected.masse_mm && `Maße: ${selected.masse_mm}`,
                    selected.m2_lfm && `m²/Lfm: ${selected.m2_lfm}`,
                    selected.haendler && `Händler: ${selected.haendler}`,
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button
                onClick={() => { setSelected(null); setSearch('') }}
                className="text-muted hover:text-white text-lg leading-none shrink-0"
              >
                ×
              </button>
            </div>

            {/* Menge */}
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
                  VK-Preis
                </label>
                <div className="border border-border px-4 py-2.5 text-muted font-opensans text-sm">
                  {selected.vk_preis !== null ? `€ ${selected.vk_preis.toFixed(2)}` : '–'}
                </div>
              </div>
            </div>

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
