import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Logo } from './Logo'

export function Header() {
  const { user, profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo + Name */}
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <Logo size={36} />
          <span className="font-raleway font-semibold text-white text-sm tracking-widest uppercase hidden sm:block">
            Aufgemöbelt
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-6">
          <Link
            to="/"
            className="font-raleway text-xs tracking-widest uppercase text-white hover:text-muted transition-colors"
          >
            Projekte
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
            <div className="flex items-center gap-4 border-l border-border pl-6">
              <span className="text-xs text-muted font-opensans hidden sm:block">
                {profile?.name ?? user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="font-raleway text-xs tracking-widest uppercase text-white border border-border px-3 py-1.5 hover:bg-white hover:text-black transition-colors"
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
