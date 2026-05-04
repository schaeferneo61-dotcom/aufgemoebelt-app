import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { AdminPage } from './pages/AdminPage'
import { DispoPage } from './pages/DispoPage'
import { NameSetupOverlay } from './components/NameSetupOverlay'
import { processQueue, getQueueCount } from './lib/offlineQueue'

function NameGuard() {
  const { user, profile, loading } = useAuth()
  if (loading || !user || !profile) return null
  if (profile.name && profile.name.trim().length > 0) return null
  return <NameSetupOverlay />
}

export default function App() {
  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine) return
      if (getQueueCount() === 0) return
      const result = await processQueue()
      window.dispatchEvent(new CustomEvent('offlineQueueUpdated', { detail: result }))
    }
    sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [])

  return (
    <AuthProvider>
      <BrowserRouter>
        <NameGuard />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <ProjectsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projekt/:id"
            element={
              <ProtectedRoute>
                <ProjectDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dispo"
            element={
              <ProtectedRoute>
                <DispoPage />
              </ProtectedRoute>
            }
          />
          {/* Alte Route weiterleiten */}
          <Route path="/arbeitszeit" element={<Navigate to="/dispo" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
