import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getQueueCount } from '../lib/offlineQueue'

const ROLLE_DISPLAY: Record<string, string> = {
  admin: 'Admin',
  projektleiter: 'Projektleitung',
  mitarbeiter: 'Team',
}

export function Header() {
  const { user, profile, isAdminOrProjektleiter, signOut } = useAuth()
  const navigate = useNavigate()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(getQueueCount)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    const handleQueueUpdated = () => setPendingCount(getQueueCount())
    const handleFocus = () => setPendingCount(getQueueCount())
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('offlineQueueUpdated', handleQueueUpdated)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('offlineQueueUpdated', handleQueueUpdated)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const rolleDisplay = profile?.rolle ? (ROLLE_DISPLAY[profile.rolle] ?? profile.rolle) : null

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-border"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="relative h-14">

        {/* Logo – absolut links */}
        <div className="absolute left-0 top-0 bottom-0 flex items-center px-4">
          <Link to="/" className="hover:opacity-70 transition-opacity flex items-center">
            <img src="/logo.png" alt="aufgemoebelt" className="w-7 h-7 object-contain" />
          </Link>
        </div>

        {/* Rolle – mittig */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {rolleDisplay && (
            <Link
              to={isAdminOrProjektleiter ? '/admin' : '/dispo'}
              className="pointer-events-auto font-raleway font-semibold text-white text-[11px] tracking-[0.2em] uppercase hover:opacity-70 transition-opacity"
            >
              {rolleDisplay}
            </Link>
          )}
        </div>

        {/* Offline-Indikator */}
        {(!isOnline || pendingCount > 0) && (
          <div className="absolute top-0 bottom-0 flex items-center justify-center pointer-events-none" style={{ left: '56px', right: '50%' }}>
            <span className="font-raleway text-[9px] tracking-widest uppercase text-yellow-400 border border-yellow-400/40 px-2 py-1 whitespace-nowrap">
              {!isOnline ? 'Offline' : `${pendingCount} ausstehend`}
            </span>
          </div>
        )}

        {/* Abmelden – absolut rechts */}
        <div className="absolute right-0 top-0 bottom-0 flex items-center px-4">
          {user && (
            <button
              onClick={handleSignOut}
              className="font-raleway text-[10px] tracking-widest uppercase text-white border border-border px-3 py-1.5 hover:bg-white hover:text-black transition-colors whitespace-nowrap"
            >
              Abmelden
            </button>
          )}
        </div>

      </div>
    </header>
  )
}
