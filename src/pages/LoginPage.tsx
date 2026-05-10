import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/Logo'

type Mode = 'login' | 'register'

function EyeIcon({ open, className }: { open: boolean; className?: string }) {
  return open ? (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function mapAuthError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('already exists'))
    return 'Diese E-Mail ist bereits registriert.'
  if (m.includes('invalid email') || m.includes('invalid format') || m.includes('unable to validate'))
    return 'Ungültige E-Mail-Adresse.'
  if (m.includes('rate limit') || m.includes('too many') || (m.includes('after') && m.includes('seconds')))
    return 'Zu viele Versuche. Bitte kurz warten und nochmal versuchen.'
  if (m.includes('signup') && (m.includes('disabled') || m.includes('not allowed')))
    return 'Registrierung ist derzeit deaktiviert. Bitte Administrator kontaktieren.'
  if (m.includes('password') && m.includes('6'))
    return 'Passwort muss mindestens 6 Zeichen lang sein.'
  if (m.includes('network') || m.includes('fetch'))
    return 'Netzwerkfehler. Bitte Verbindung prüfen und nochmal versuchen.'
  return `Registrierung fehlgeschlagen: ${msg}`
}

export function LoginPage() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('login')

  // Login fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  // Register fields
  const [vorname, setVorname] = useState('')
  const [nachname, setNachname] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regPassword2, setRegPassword2] = useState('')
  const [showRegPw, setShowRegPw] = useState(false)
  const [showRegPw2, setShowRegPw2] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)

  const switchMode = (m: Mode) => {
    setMode(m)
    setError(null)
    setConfirmationSent(false)
    setShowPw(false)
    setShowRegPw(false)
    setShowRegPw2(false)
  }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) {
      setError('E-Mail oder Passwort falsch.')
      setLoading(false)
    } else {
      navigate('/')
    }
  }

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()
    if (!vorname.trim() || !nachname.trim()) {
      setError('Bitte Vor- und Nachname eingeben.')
      return
    }
    if (regPassword.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen lang sein.')
      return
    }
    if (regPassword !== regPassword2) {
      setError('Passwörter stimmen nicht überein.')
      return
    }
    setLoading(true)
    setError(null)
    const name = `${vorname.trim()} ${nachname.trim()}`
    const { error, needsConfirmation } = await signUp(regEmail, regPassword, name)
    if (error) {
      setError(mapAuthError(error))
      setLoading(false)
      return
    }
    if (needsConfirmation) {
      setConfirmationSent(true)
      setLoading(false)
    } else {
      navigate('/')
    }
  }

  const inputCls = 'w-full bg-transparent border border-border text-white px-4 py-3.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted'
  const inputSmCls = 'w-full bg-transparent border border-border text-white px-3 py-3.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted'

  return (
    <div
      className="min-h-screen bg-black flex flex-col items-center justify-center px-4"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Logo */}
      <div className="mb-10 flex flex-col items-center gap-4">
        <Logo size={72} />
        <div className="text-center">
          <h1 className="font-raleway font-semibold text-white tracking-widest text-xl">aufgemoebelt</h1>
          <p className="text-muted font-opensans text-xs mt-1 tracking-wider">Warenwirtschaft</p>
        </div>
      </div>

      <div className="w-full max-w-sm">
        <div className="border-t border-border" />

        {/* Mode toggle */}
        <div className="grid grid-cols-2 border-b border-border mb-8">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`py-3 font-raleway text-[10px] uppercase tracking-widest transition-colors ${
              mode === 'login'
                ? 'text-white border-b-2 border-white -mb-px'
                : 'text-muted hover:text-white/70'
            }`}
          >
            Einloggen
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`py-3 font-raleway text-[10px] uppercase tracking-widest transition-colors ${
              mode === 'register'
                ? 'text-white border-b-2 border-white -mb-px'
                : 'text-muted hover:text-white/70'
            }`}
          >
            Registrieren
          </button>
        </div>

        {/* ── Login ── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">E-Mail</label>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                required autoComplete="email"
                placeholder="name@aufgemoebelt.net"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">Passwort</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  required autoComplete="current-password"
                  placeholder="••••••••"
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors"
                  tabIndex={-1}
                >
                  <EyeIcon open={showPw} className="w-4 h-4" />
                </button>
              </div>
            </div>
            {error && (
              <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">{error}</p>
            )}
            <button type="submit" disabled={loading}
              className="w-full bg-white text-black py-4 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-50 mt-2">
              {loading ? 'Einloggen…' : 'Einloggen'}
            </button>
          </form>
        )}

        {/* ── Registrieren ── */}
        {mode === 'register' && !confirmationSent && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">Vorname</label>
                <input
                  type="text" value={vorname}
                  onChange={e => setVorname(e.target.value)}
                  required autoComplete="given-name"
                  placeholder="Max"
                  className={inputSmCls}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">Nachname</label>
                <input
                  type="text" value={nachname}
                  onChange={e => setNachname(e.target.value)}
                  required autoComplete="family-name"
                  placeholder="Muster"
                  className={inputSmCls}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">E-Mail</label>
              <input
                type="email" value={regEmail}
                onChange={e => setRegEmail(e.target.value)}
                required autoComplete="email"
                placeholder="name@aufgemoebelt.net"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">Passwort</label>
              <div className="relative">
                <input
                  type={showRegPw ? 'text' : 'password'} value={regPassword}
                  onChange={e => setRegPassword(e.target.value)}
                  required autoComplete="new-password"
                  placeholder="••••••••"
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowRegPw(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors"
                  tabIndex={-1}
                >
                  <EyeIcon open={showRegPw} className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">Passwort wiederholen</label>
              <div className="relative">
                <input
                  type={showRegPw2 ? 'text' : 'password'} value={regPassword2}
                  onChange={e => setRegPassword2(e.target.value)}
                  required autoComplete="new-password"
                  placeholder="••••••••"
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowRegPw2(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors"
                  tabIndex={-1}
                >
                  <EyeIcon open={showRegPw2} className="w-4 h-4" />
                </button>
              </div>
            </div>
            {error && (
              <p className="text-red-400 text-xs font-opensans border border-red-400/30 px-4 py-3">{error}</p>
            )}
            <button type="submit" disabled={loading}
              className="w-full bg-white text-black py-4 font-raleway font-semibold text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-50 mt-2">
              {loading ? 'Konto erstellen…' : 'Konto erstellen'}
            </button>
            <p className="text-muted text-[10px] font-opensans text-center leading-relaxed pt-1">
              Neues Konto erhält automatisch die Rolle Mitarbeiter.
              Projektleitung und Admin werden vom Administrator vergeben.
            </p>
          </form>
        )}

        {/* ── E-Mail Bestätigung ── */}
        {mode === 'register' && confirmationSent && (
          <div className="text-center space-y-4">
            <div className="border border-border px-6 py-8">
              <p className="font-raleway font-semibold text-white text-xs uppercase tracking-widest mb-3">
                Bestätigung erforderlich
              </p>
              <p className="font-opensans text-sm text-muted leading-relaxed">
                Wir haben eine Bestätigungs-E-Mail an <span className="text-white">{regEmail}</span> gesendet.
                Bitte E-Mail öffnen und Konto bestätigen.
              </p>
            </div>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full border border-border text-white py-3.5 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
            >
              Zum Login
            </button>
          </div>
        )}

        <div className="border-b border-border mt-8" />
        <p className="text-muted text-xs font-opensans text-center mt-6">Made by Neo Schaefer</p>
      </div>
    </div>
  )
}
