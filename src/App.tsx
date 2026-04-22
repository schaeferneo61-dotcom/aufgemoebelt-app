import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { AdminPage } from './pages/AdminPage'
import { processQueue, getQueueCount } from './lib/offlineQueue'

export default function App() {
  // Warteschlange global synchronisieren – egal auf welcher Seite der Nutzer ist.
  // Triggern bei Online-Event UND beim Mount (App kann mit Online + pending Queue starten).
  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine) return
      if (getQueueCount() === 0) return
      const result = await processQueue()
      window.dispatchEvent(new CustomEvent('offlineQueueUpdated', { detail: result }))
    }
    sync() // Initialer Sync beim Mount
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [])

  return (
    <AuthProvider>
      <BrowserRouter>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
