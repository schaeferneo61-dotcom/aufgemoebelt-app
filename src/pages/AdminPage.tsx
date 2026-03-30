import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'
import { parseProductExcel, parseProductExcelFromUrl } from '../lib/excel'
import { syncProSonata, PROSONATA_KEY, PROSONATA_LAST_SYNC } from '../lib/prosonata'
import type { Product, Profile } from '../types'
import { Navigate } from 'react-router-dom'

const STORAGE_BUCKET = 'produktliste'
const STORAGE_FILE = 'produktliste.xlsx'

export function getProduktlisteUrl(): string {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(STORAGE_FILE)
  return data.publicUrl
}

export function AdminPage() {
  const { isAdmin, isAdminOrProjektleiter } = useAuth()
  if (!isAdminOrProjektleiter) return <Navigate to="/" replace />

  return (
    <div className="min-h-screen bg-black overflow-x-hidden">
      <Header />
      <main
        className="max-w-6xl mx-auto px-4"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 4rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 4rem)',
        }}
      >
        <div className="border-b border-border pb-8 mb-10 mt-6">
          <h1 className="font-raleway font-semibold text-white text-2xl sm:text-3xl uppercase tracking-widest">
            {isAdmin ? 'Administration' : 'Waren'}
          </h1>
          <p className="text-muted font-opensans text-sm mt-1">
            {isAdmin ? 'Warenverwaltung, ProSonata-Sync und Benutzer' : 'Warenliste verwalten'}
          </p>
        </div>

        <div className="space-y-12">
          <ProductImport />
          {isAdmin && <ProSonataSync />}
          {isAdmin && <UserManagement />}
        </div>
      </main>
    </div>
  )
}

// ── Produkt-Import ───────────────────────────────────────────

async function saveProducts(incoming: Omit<Product, 'id' | 'created_at' | 'updated_at'>[]) {
  if (incoming.length === 0) throw new Error('Keine Waren in der Datei gefunden')

  // Bestehende Produkte laden um IDs zu erhalten
  const { data: existing } = await supabase.from('products').select('id, produkt')
  const existingMap = new Map((existing ?? []).map(p => [p.produkt, p.id as string]))

  const toUpdate: (Omit<Product, 'created_at' | 'updated_at'>)[] = []
  const toInsert: Omit<Product, 'id' | 'created_at' | 'updated_at'>[] = []

  for (const p of incoming) {
    const existingId = existingMap.get(p.produkt)
    if (existingId) {
      toUpdate.push({ ...p, id: existingId })
    } else {
      toInsert.push(p)
    }
  }

  if (toUpdate.length > 0) {
    const { error } = await supabase.from('products').upsert(toUpdate)
    if (error) throw new Error(error.message)
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from('products').insert(toInsert)
    if (error) throw new Error(error.message)
  }
  return incoming.length
}

function ProductImport() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [productCount, setProductCount] = useState<number | null>(null)
  const [hasFile, setHasFile] = useState(false)

  useEffect(() => {
    supabase.from('products').select('id', { count: 'exact', head: true }).then(({ count }) => {
      setProductCount(count ?? 0)
      setHasFile((count ?? 0) > 0)
    })
  }, [status])

  // Neue Datei hochladen (ersetzt die gespeicherte Excel)
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setStatus(null)

    try {
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(STORAGE_FILE, file, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

      if (uploadError) throw new Error('Upload fehlgeschlagen: ' + uploadError.message)

      const products = await parseProductExcel(file)
      const count = await saveProducts(products)

      setStatus({ type: 'success', msg: `✓ ${count} Waren hochgeladen und synchronisiert. Das gesamte Team sieht jetzt die aktuellen Waren.` })
      setHasFile(true)
    } catch (err) {
      setStatus({ type: 'error', msg: String(err) })
    }

    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // Automatisch aus gespeicherter Excel aktualisieren (kein Upload nötig)
  const handleAutoSync = async () => {
    setSyncing(true)
    setStatus(null)
    try {
      const url = getProduktlisteUrl()
      const products = await parseProductExcelFromUrl(url)
      const count = await saveProducts(products)
      setStatus({ type: 'success', msg: `✓ ${count} Waren aktualisiert – neue Kategorien und Waren wurden automatisch hinzugefügt.` })
    } catch (err) {
      setStatus({ type: 'error', msg: 'Aktualisierung fehlgeschlagen: ' + String(err) })
    }
    setSyncing(false)
  }

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        Warenliste
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        {productCount !== null && (
          <><span className="text-white">{productCount}</span> Waren gespeichert · </>
        )}
        Klicke auf „Excel aktualisieren" um neue Waren automatisch einzulesen. Nur wenn die Excel-Datei selbst ausgetauscht wurde, neu hochladen.
      </p>

      <div className="border border-border p-6 flex flex-col gap-4">
        {/* Primär: Automatische Aktualisierung */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <button
            onClick={handleAutoSync}
            disabled={syncing || uploading || !hasFile}
            className="bg-white text-black px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            {syncing ? 'Aktualisiert…' : '↻ Excel aktualisieren'}
          </button>
          <p className="text-white font-opensans text-xs">
            {hasFile
              ? 'Liest die gespeicherte Excel automatisch – kein Upload nötig.'
              : 'Zuerst Excel hochladen (einmalig).'}
          </p>
        </div>

        {/* Sekundär: Neue Datei hochladen */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-3 border-t border-border">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            className="hidden"
            id="product-file"
          />
          <label
            htmlFor="product-file"
            className={`cursor-pointer border border-border text-white px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors whitespace-nowrap ${uploading || syncing ? 'opacity-40 pointer-events-none' : ''}`}
          >
            {uploading ? 'Wird hochgeladen…' : '↑ Neue Excel hochladen'}
          </label>
          <p className="text-muted font-opensans text-xs">
            Nur nötig wenn die Datei selbst ersetzt werden soll (.xlsx, .xls)
          </p>
        </div>
      </div>

      {status && (
        <div className={`mt-3 px-4 py-3 border text-xs font-opensans ${
          status.type === 'success' ? 'border-green-400/30 text-green-400' : 'border-red-400/30 text-red-400'
        }`}>
          {status.msg}
        </div>
      )}
    </section>
  )
}

// ── ProSonata Synchronisierung ───────────────────────────────

function ProSonataSync() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(PROSONATA_KEY) ?? '')
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(() => localStorage.getItem(PROSONATA_LAST_SYNC))

  const sync = async () => {
    if (!apiKey.trim()) {
      setStatus({ type: 'error', msg: 'Bitte zuerst den ProSonata API-Key eingeben.' })
      return
    }
    localStorage.setItem(PROSONATA_KEY, apiKey.trim())
    setSyncing(true)
    setStatus(null)

    const result = await syncProSonata(apiKey.trim())
    if (result.error && result.count === 0) {
      setStatus({ type: 'error', msg: 'Sync fehlgeschlagen: ' + result.error })
    } else {
      const now = localStorage.getItem(PROSONATA_LAST_SYNC) ?? new Date().toLocaleString('de-AT')
      setLastSync(now)
      setStatus({
        type: 'success',
        msg: `✓ ${result.count} Projekte aus ProSonata synchronisiert. Projekte mit „intern" in der Firma/Gruppe werden automatisch als Intern markiert.`,
      })
    }
    setSyncing(false)
  }

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        ProSonata Synchronisierung
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        Projekte aus ProSonata automatisch übernehmen. Synchronisiert sich auch automatisch wenn die App geöffnet wird (alle 2 Minuten).
        {lastSync && <span className="ml-2 text-white">Letzter Sync: {lastSync}</span>}
      </p>

      <div className="border border-border p-6 space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">
            ProSonata API-Key
          </label>
          <div className="flex gap-3 flex-col sm:flex-row">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="ProSonata API-Key eingeben"
              className="flex-1 bg-transparent border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
            />
            <button
              onClick={sync}
              disabled={syncing}
              className="bg-white text-black px-6 py-2.5 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {syncing ? 'Synchronisiere...' : '↻ Jetzt synchronisieren'}
            </button>
          </div>
        </div>
        <p className="text-muted font-opensans text-xs">
          Den API-Key finden Sie in ProSonata unter{' '}
          <span className="text-white">System → Integrationen → API-Key generieren</span>
        </p>
      </div>

      {status && (
        <div className={`mt-3 px-4 py-3 border text-xs font-opensans ${
          status.type === 'success' ? 'border-green-400/30 text-green-400' : 'border-red-400/30 text-red-400'
        }`}>
          {status.msg}
        </div>
      )}
    </section>
  )
}

// ── Benutzerverwaltung ───────────────────────────────────────

function UserDetailModal({
  user,
  onClose,
  onSaved,
}: {
  user: Profile
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(user.name ?? '')
  const [role, setRole] = useState<'admin' | 'projektleiter' | 'mitarbeiter'>(user.rolle)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      if (name !== (user.name ?? '')) {
        const { error } = await supabase.rpc('admin_update_user_name', { target_user_id: user.id, new_name: name })
        if (error) throw new Error('Name: ' + error.message)
      }
      if (role !== user.rolle) {
        const { error } = await supabase.rpc('admin_update_user_role', { target_user_id: user.id, new_role: role })
        if (error) throw new Error('Rolle: ' + error.message)
      }
      if (newPassword.trim().length >= 6) {
        const { error } = await supabase.rpc('admin_update_user_password', { target_user_id: user.id, new_password: newPassword.trim() })
        if (error) throw new Error('Passwort: ' + error.message)
      }
      setStatus({ type: 'success', msg: 'Gespeichert.' })
      setTimeout(onSaved, 800)
    } catch (err) {
      setStatus({ type: 'error', msg: String(err) })
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8">
      <div className="bg-black border border-border w-full max-w-md p-6 space-y-4 overflow-y-auto max-h-full">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-raleway text-sm uppercase tracking-widest text-white">Benutzer bearbeiten</h3>
          <button onClick={onClose} className="text-muted hover:text-white text-xl leading-none">×</button>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-transparent border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">E-Mail</label>
          <p className="font-opensans text-sm text-muted px-4 py-2.5 border border-border/50">{user.email ?? '–'}</p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">Rolle</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'projektleiter' | 'mitarbeiter')}
            className="w-full bg-black border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none appearance-none rounded-none"
          >
            <option value="mitarbeiter">Team</option>
            <option value="projektleiter">Projektleitung</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">Neues Passwort</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Leer lassen = nicht ändern (min. 6 Zeichen)"
            className="w-full bg-transparent border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
          />
        </div>

        {status && (
          <div className={`px-4 py-3 border text-xs font-opensans ${
            status.type === 'success' ? 'border-green-400/30 text-green-400' : 'border-red-400/30 text-red-400'
          }`}>
            {status.msg}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-white text-black px-6 py-2.5 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40"
          >
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
          <button
            onClick={onClose}
            className="border border-border text-white px-6 py-2.5 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}

function UserManagement() {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteRole, setInviteRole] = useState<'mitarbeiter' | 'projektleiter' | 'admin'>('mitarbeiter')
  const [creating, setCreating] = useState(false)
  const [createStatus, setCreateStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null)

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers((data as Profile[]) ?? [])
    setLoading(false)
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateStatus(null)

    const { error } = await supabase.auth.signUp({
      email: inviteEmail,
      password: invitePassword,
      options: {
        data: { name: inviteName, rolle: inviteRole },
      },
    })

    if (error) {
      setCreateStatus({ type: 'error', msg: error.message })
    } else {
      setCreateStatus({ type: 'success', msg: `Benutzer "${inviteName}" wurde angelegt.` })
      setInviteEmail('')
      setInviteName('')
      setInvitePassword('')
      setInviteRole('mitarbeiter')
      setTimeout(loadUsers, 1000)
    }
    setCreating(false)
  }

  async function changeRole(userId: string, role: 'admin' | 'projektleiter' | 'mitarbeiter') {
    const { error } = await supabase.rpc('admin_update_user_role', { target_user_id: userId, new_role: role })
    if (error) { alert('Rolle konnte nicht geändert werden: ' + error.message); return }
    loadUsers()
  }

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        Benutzerverwaltung
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        Team anlegen und Rollen verwalten
      </p>

      <div className="border border-border p-6 mb-6">
        <h3 className="font-raleway text-xs uppercase tracking-widest text-muted mb-4">
          Neuen Benutzer anlegen
        </h3>
        <form onSubmit={createUser} className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">Name</label>
            <input
              type="text"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              required
              placeholder="Vorname Nachname"
              className="w-full bg-transparent border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">E-Mail</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              placeholder="name@aufgemoebelt.net"
              className="w-full bg-transparent border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">Passwort</label>
            <input
              type="password"
              value={invitePassword}
              onChange={(e) => setInvitePassword(e.target.value)}
              required
              minLength={6}
              placeholder="Mindestens 6 Zeichen"
              className="w-full bg-transparent border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors placeholder-muted"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-1.5">Rolle</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'mitarbeiter' | 'projektleiter' | 'admin')}
              className="w-full bg-black border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors appearance-none rounded-none"
            >
              <option value="mitarbeiter">Team</option>
              <option value="projektleiter">Projektleitung</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="bg-white text-black px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40"
            >
              {creating ? 'Wird angelegt...' : 'Benutzer anlegen'}
            </button>
          </div>
        </form>
        {createStatus && (
          <div className={`mt-3 px-4 py-3 border text-xs font-opensans ${
            createStatus.type === 'success' ? 'border-green-400/30 text-green-400' : 'border-red-400/30 text-red-400'
          }`}>
            {createStatus.msg}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted text-sm font-opensans">
          <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          Lade Benutzer...
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {users.map((u) => (
            <div
              key={u.id}
              className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-surface transition-colors"
              onClick={() => setSelectedUser(u)}
            >
              <div className="min-w-0 flex-1">
                <p className="font-opensans text-sm text-white truncate">{u.name ?? '(kein Name)'}</p>
                <p className="font-opensans text-xs text-muted truncate">{u.email ?? ''}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                <select
                  value={u.rolle}
                  onChange={(e) => changeRole(u.id, e.target.value as 'admin' | 'projektleiter' | 'mitarbeiter')}
                  className="bg-black border border-border text-white px-2 py-2 font-opensans text-xs focus:border-white outline-none appearance-none rounded-none min-w-[100px]"
                >
                  <option value="mitarbeiter">Team</option>
                  <option value="projektleiter">Projektleitung</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onSaved={() => { loadUsers(); setSelectedUser(null) }}
        />
      )}
    </section>
  )
}
