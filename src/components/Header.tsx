import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Header() {
  const { user, profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-border"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="max-w-screen-lg mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo + Name */}
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
          <img src="/logo.png" alt="Aufgemoebelt Logo" className="w-8 h-8 object-contain" />
          <span className="font-raleway font-semibold text-white text-xs tracking-widest hidden sm:block">
            aufgemoebelt
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-4">
          <Link
            to="/"
            className="font-raleway text-xs tracking-widest uppercase text-white hover:text-muted transition-colors"
          >
            Warenwirtschaft
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              className="font-raleway text-xs tracking-widest uppercase text-white hover:text-muted transition-colors"
            >
              Admin
            </Link>
          )}
          {user && (
            <div className="flex items-center gap-3 border-l border-border pl-4">
              <span className="text-xs text-muted font-opensans hidden sm:block truncate max-w-[120px]">
                {profile?.name ?? user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="font-raleway text-xs tracking-widest uppercase text-white border border-border px-3 py-1.5 hover:bg-white hover:text-black transition-colors whitespace-nowrap"
              >
                Abmelden
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}
