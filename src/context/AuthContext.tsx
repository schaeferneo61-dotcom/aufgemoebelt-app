import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** true sobald das Profil einmal frisch aus der DB bestätigt wurde (nicht nur aus dem Cache) */
  profileReady: boolean
  isAdmin: boolean
  isProjektleiter: boolean
  isAdminOrProjektleiter: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null; needsConfirmation: boolean }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

const PROFILE_CACHE_KEY = 'aufgemoebelt_profile'

function getCachedProfile(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Profile
    return p.id === userId ? p : null
  } catch { return null }
}
function setCachedProfile(p: Profile) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)) } catch {}
}
function clearCachedProfile() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY) } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileReady, setProfileReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId: string) {
    // Cache sofort anzeigen → kein Ladeflash für wiederkehrende User
    const cached = getCachedProfile(userId)
    if (cached) {
      setProfile(cached)
      setLoading(false)
    }

    // Immer frisch aus DB laden (im Hintergrund, falls Cache schon angezeigt)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (data) {
      setCachedProfile(data as Profile)
      setProfile(data as Profile)
      setLoading(false)
      setProfileReady(true)
      return
    }

    // Kein Profil gefunden → aus User-Metadaten erstellen (E-Mail-Bestätigungs-Flow)
    const { data: { user } } = await supabase.auth.getUser()
    const name = (user?.user_metadata?.full_name as string | undefined) ?? null
    const newProfile: Profile = { id: userId, name, rolle: 'mitarbeiter', created_at: new Date().toISOString() }
    await supabase.from('profiles').upsert(
      { id: userId, name, rolle: 'mitarbeiter' },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    setCachedProfile(newProfile)
    setProfile(newProfile)
    setLoading(false)
    setProfileReady(true)
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signUp(email: string, password: string, name: string): Promise<{ error: string | null; needsConfirmation: boolean }> {
    const trimmed = name.trim()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: trimmed } },
    })
    if (error) return { error: error.message, needsConfirmation: false }
    if (!data.user) return { error: 'Registrierung fehlgeschlagen.', needsConfirmation: false }

    if (data.session) {
      // Direkt eingeloggt (keine E-Mail-Bestätigung nötig) → Profil sofort anlegen
      await supabase.from('profiles').upsert(
        { id: data.user.id, name: trimmed, rolle: 'mitarbeiter' },
        { onConflict: 'id', ignoreDuplicates: true }
      )
      await loadProfile(data.user.id)
    }
    // Bei E-Mail-Bestätigung: Profil wird beim ersten Login via loadProfile angelegt

    return { error: null, needsConfirmation: !data.session }
  }

  async function signOut() {
    clearCachedProfile()
    setProfileReady(false)
    await supabase.auth.signOut()
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id)
  }

  const isAdmin = profile?.rolle === 'admin'
  const isProjektleiter = profile?.rolle === 'projektleiter'
  const isAdminOrProjektleiter = isAdmin || isProjektleiter

  const value: AuthContextType = {
    user,
    session,
    profile,
    loading,
    profileReady,
    isAdmin,
    isProjektleiter,
    isAdminOrProjektleiter,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden')
  return ctx
}
