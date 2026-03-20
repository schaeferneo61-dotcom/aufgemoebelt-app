import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/Logo'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) {
      setError('E-Mail oder Passwort falsch.')
    } else {
      navigate('/')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-10 flex flex-col items-center gap-4">
        <Logo size={72} />
        <div className="text-center">
          <h1 className="font-raleway font-semibold text-white tracking-widest uppercase text-xl">
            Aufgemöbelt
          </h1>
          <p className="text-muted font-opensans text-xs mt-1 tracking-wider">
            Projektmanagement
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="w-full max-w-sm">
        <div className="border-t border-border mb-8" />
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
              E-Mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-transparent border border-border text-white px-4 py-3.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
              placeholder="name@aufgemoebelt.net"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
              Passwort
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-transparent border border-border text-white px-4 py-3.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black py-4 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-50 mt-2"
          >
            {loading ? 'Einloggen...' : 'Einloggen'}
          </button>
        </form>
        <div className="border-b border-border mt-8" />
        <p className="text-muted text-xs font-opensans text-center mt-6">
          Kein Zugang? Kontakt an den Administrator.
        </p>
      </div>
    </div>
  )
}
