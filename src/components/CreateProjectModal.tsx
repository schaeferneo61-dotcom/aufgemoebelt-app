import { useState } from 'react'
import { Modal } from './Modal'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)

    const { error } = await supabase.from('projects').insert({
      name: name.trim(),
      beschreibung: beschreibung.trim() || null,
      erstellt_von: user?.id ?? null,
      status: 'aktiv',
    })

    if (error) {
      setError(error.message)
    } else {
      setName('')
      setBeschreibung('')
      onCreated()
      onClose()
    }
    setLoading(false)
  }

  return (
    <Modal open={open} onClose={onClose} title="Neues Projekt">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
            Projektname *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-transparent border border-border text-white px-4 py-3 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
            placeholder="z.B. Umbau Café Mayer"
            required
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
            Beschreibung
          </label>
          <textarea
            value={beschreibung}
            onChange={(e) => setBeschreibung(e.target.value)}
            rows={3}
            className="w-full bg-transparent border border-border text-white px-4 py-3 font-opensans text-sm focus:border-white outline-none transition-colors resize-none placeholder-muted"
            placeholder="Optionale Projektbeschreibung..."
          />
        </div>
        {error && (
          <p className="text-red-400 text-xs font-opensans">{error}</p>
        )}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-border text-white py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="flex-1 bg-white text-black py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40"
          >
            {loading ? 'Wird erstellt...' : 'Erstellen'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
