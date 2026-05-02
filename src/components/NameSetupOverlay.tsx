import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Logo } from './Logo'

/**
 * Erscheint nach dem Login, wenn das Profil noch keinen Namen hat.
 * Der Name wird zum Abgleich mit ProSonata-Arbeitszeiten verwendet.
 */
export function NameSetupOverlay() {
  const { user, refreshProfile } = useAuth()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const first = firstName.trim()
    const last = lastName.trim()
    if (!first || !last || !user) return

    setSaving(true)
    setError(null)

    const fullName = `${first} ${last}`
    const { error: dbError } = await supabase
      .from('profiles')
      .update({ name: fullName })
      .eq('id', user.id)

    if (dbError) {
      setError('Name konnte nicht gespeichert werden. Bitte wende dich an den Administrator.')
      setSaving(false)
      return
    }

    await refreshProfile()
    // Overlay verschwindet automatisch, sobald profile.name gesetzt ist
  }

  return (
    <div
      className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center px-4"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mb-10 flex flex-col items-center gap-4">
        <Logo size={56} />
        <div className="text-center">
          <h1 className="font-raleway font-semibold text-white tracking-widest text-xl">
            aufgemoebelt
          </h1>
        </div>
      </div>

      <div className="w-full max-w-sm">
        <div className="border-t border-border mb-8" />

        <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-2">
          Vollständiger Name
        </h2>
        <p className="text-muted font-opensans text-xs mb-6 leading-relaxed">
          Bitte gib deinen Vor- und Nachnamen ein – exakt so, wie er in ProSonata steht.
          Damit werden deine Arbeitszeiten der richtigen Person zugeordnet.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
              Vorname
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoComplete="given-name"
              autoFocus
              placeholder="z. B. Neo"
              className="w-full bg-transparent border border-border text-white px-4 py-3.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
              Nachname
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              autoComplete="family-name"
              placeholder="z. B. Schäfer"
              className="w-full bg-transparent border border-border text-white px-4 py-3.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !firstName.trim() || !lastName.trim()}
            className="w-full bg-white text-black py-4 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-50 mt-2"
          >
            {saving ? 'Wird gespeichert…' : 'Weiter'}
          </button>
        </form>

        <div className="border-b border-border mt-8" />
        <p className="text-muted text-xs font-opensans text-center mt-6">
          Der Name kann später vom Administrator geändert werden.
        </p>
      </div>
    </div>
  )
}
