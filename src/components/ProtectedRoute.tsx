import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface Props {
  children: React.ReactNode
  adminOnly?: boolean
}

export function ProtectedRoute({ children, adminOnly = false }: Props) {
  const { user, isAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />

  return <>{children}</>
}
