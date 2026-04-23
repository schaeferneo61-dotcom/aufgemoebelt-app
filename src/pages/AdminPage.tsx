import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'
import { parseProductExcel, parseProductExcelFromUrl, exportVerbrauchToExcel } from '../lib/excel'
import type { VerbrauchRow } from '../lib/excel'
import type { Product, Profile } from '../types'
import { Navigate } from 'react-router-dom'
import { clearProductsCache } from '../components/AddProductModal'

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
          <VerbrauchsExport />
          {isAdmin && <ProSonataSync />}
          {isAdmin && <UserManagement />}
        </div>
      </main>
    </div>
  )
}

// ── Produkt-Import ───────────────────────────────────────────

// verfuegbar wird NICHT mitgesendet – der DB-Trigger berechnet es atomar
type ProductImportRow = Omit<Product, 'id' | 'created_at' | 'updated_at' | 'verfuegbar'>

// Eindeutiger Schlüssel pro Produkt: Name + Stärke + Maße (für Varianten wie MDF 8mm / 16mm / 19mm)
function productKey(produkt: string, staerke_mm: string | null, masse_mm: string | null) {
  return `${produkt}|${staerke_mm ?? ''}|${masse_mm ?? ''}`
}

async function saveProducts(incoming: ProductImportRow[]) {
  if (incoming.length === 0) throw new Error('Keine Waren in der Datei gefunden')

  // Bestehende Produkte laden um IDs zu erhalten (inkl. Stärke + Maße für Variantenmatching)
  const { data: existing, error: fetchError } = await supabase
    .from('products')
    .select('id, produkt, staerke_mm, masse_mm')
  if (fetchError) throw new Error('Fehler beim Laden der Warenliste: ' + fetchError.message)

  // Composite Key → ID Map
  const existingMap = new Map(
    (existing ?? []).map(p => [productKey(p.produkt, p.staerke_mm, p.masse_mm), p.id as string])
  )

  const toUpdate: (ProductImportRow & { id: string })[] = []
  const toInsert: ProductImportRow[] = []

  for (const p of incoming) {
    const key = productKey(p.produkt, p.staerke_mm, p.masse_mm)
    const existingId = existingMap.get(key)
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

  // Neue Excel hochladen – speichert sie und importiert alle Waren
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
      clearProductsCache()
      setStatus({ type: 'success', msg: `✓ ${count} Waren importiert.` })
      setHasFile(true)
    } catch (err) {
      setStatus({ type: 'error', msg: String(err) })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // Gespeicherte Excel erneut einlesen und Warenliste aktualisieren
  const handleSync = async () => {
    setSyncing(true)
    setStatus(null)
    try {
      const url = getProduktlisteUrl()
      const products = await parseProductExcelFromUrl(url)
      const count = await saveProducts(products)
      clearProductsCache()
      setStatus({ type: 'success', msg: `✓ ${count} Waren aktualisiert.` })
    } catch (err) {
      setStatus({ type: 'error', msg: 'Aktualisierung fehlgeschlagen: ' + String(err) })
    }
    setSyncing(false)
  }

  const busy = uploading || syncing

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        Warenliste
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        {productCount !== null && (
          <><span className="text-white">{productCount}</span> Waren gespeichert · </>
        )}
        Excel hochladen um die Warenliste zu befüllen. Bei Änderungen an der Excel einfach auf „Aktualisieren" drücken – die App liest sie erneut ein.
      </p>

      <div className="border border-border p-6 flex flex-col gap-5">

        {/* Excel hochladen */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
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
            className={`cursor-pointer bg-white text-black px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors whitespace-nowrap ${busy ? 'opacity-40 pointer-events-none' : ''}`}
          >
            {uploading ? 'Wird hochgeladen…' : '↑ Excel hochladen'}
          </label>
          <p className="text-muted font-opensans text-xs">
            {hasFile
              ? 'Neue Datei ersetzt die gespeicherte (.xlsx, .xls)'
              : 'Einmalig hochladen um die Warenliste zu starten (.xlsx, .xls)'}
          </p>
        </div>

        {/* Aktualisieren */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-4 border-t border-border">
          <button
            onClick={handleSync}
            disabled={busy || !hasFile}
            className="border border-border text-white px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            {syncing ? 'Aktualisiert…' : '↻ Aktualisieren'}
          </button>
          <p className="text-muted font-opensans text-xs">
            Excel wurde geändert? Die App liest die gespeicherte Datei erneut ein.
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

// ── Verbrauchsbericht Export ──────────────────────────────────

function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Lokale Zeitzone für Supabase-Datumsfilter (z.B. +02:00 für Österreich)
function localTzSuffix(): string {
  const offset = -new Date().getTimezoneOffset() // in Minuten, positiv für UTC+
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}

function VerbrauchsExport() {
  // Lazy initializer: wird nur einmal beim Mount berechnet, nicht bei jedem Re-Render
  const [startDate, setStartDate] = useState(() => {
    const now = new Date()
    return localDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
  })
  const [endDate, setEndDate] = useState(() => localDateStr(new Date()))
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const handleExport = async () => {
    if (!startDate || !endDate) return
    if (startDate > endDate) {
      setStatus({ type: 'error', msg: '„Von"-Datum darf nicht nach dem „Bis"-Datum liegen.' })
      return
    }
    setExporting(true)
    setStatus(null)

    try {
      const { data, error } = await supabase
        .from('project_items')
        .select(`
          menge,
          product_name,
          product_kategorie,
          created_at,
          product:products (
            produkt,
            kategorie,
            haendler,
            staerke_mm,
            masse_mm,
            ek_preis,
            vk_preis
          )
        `)
        .gte('created_at', startDate + 'T00:00:00' + localTzSuffix())
        .lte('created_at', endDate + 'T23:59:59.999' + localTzSuffix())

      if (error) throw new Error(error.message)

      if (!data || data.length === 0) {
        setStatus({ type: 'error', msg: 'Keine Buchungen im gewählten Zeitraum gefunden.' })
        setExporting(false)
        return
      }

      // Aggregieren nach Produktname (selbe Ware aus verschiedenen Projekten addieren)
      const map = new Map<string, VerbrauchRow>()
      for (const item of data) {
        const prod = item.product as {
          produkt?: string; kategorie?: string | null; haendler?: string | null
          staerke_mm?: string | null; masse_mm?: string | null
          ek_preis?: number | null; vk_preis?: number | null
        } | null
        const key = prod?.produkt ?? (item.product_name as string | null) ?? '(unbekannt)'
        const existing = map.get(key)
        if (existing) {
          existing.total_menge += Number(item.menge)
        } else {
          map.set(key, {
            produkt: key,
            kategorie: prod?.kategorie ?? (item.product_kategorie as string | null) ?? null,
            haendler: prod?.haendler ?? null,
            staerke_mm: prod?.staerke_mm ?? null,
            masse_mm: prod?.masse_mm ?? null,
            ek_preis: prod?.ek_preis ?? null,
            vk_preis: prod?.vk_preis ?? null,
            total_menge: Number(item.menge),
          })
        }
      }

      const rows = Array.from(map.values()).sort((a, b) =>
        (a.kategorie ?? '').localeCompare(b.kategorie ?? '', 'de') ||
        a.produkt.localeCompare(b.produkt, 'de')
      )

      exportVerbrauchToExcel(rows, startDate, endDate)
      setStatus({ type: 'success', msg: `✓ ${rows.length} verschiedene Waren im Zeitraum exportiert.` })
    } catch (err) {
      setStatus({ type: 'error', msg: 'Export fehlgeschlagen: ' + String(err) })
    }
    setExporting(false)
  }

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        Verbrauchsbericht
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        Alle verwendeten Waren eines Zeitraums als Excel – zusammengefasst über alle Projekte, mit Mengen und Preisen.
      </p>

      <div className="border border-border p-6 space-y-5">
        <div className="flex flex-wrap gap-6">
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
              Von (inkl.)
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-black border border-border text-white px-3 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors text-left"
              style={{ colorScheme: 'dark', width: '160px' }}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted font-raleway mb-2">
              Bis (inkl.)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-black border border-border text-white px-3 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors text-left"
              style={{ colorScheme: 'dark', width: '160px' }}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <button
            onClick={handleExport}
            disabled={exporting || !startDate || !endDate}
            className="bg-white text-black px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            {exporting ? 'Wird erstellt…' : '↓ Verbrauchsbericht als Excel'}
          </button>
          <p className="text-muted font-opensans text-xs">
            Alle Buchungen des Zeitraums, gleiche Waren addiert. Dateiname enthält beide Daten.
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

// ── ProSonata Sync ───────────────────────────────────────────

function ProSonataSync() {
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setStatus(null)
    try {
      const res = await fetch('/api/sync-prosonata', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Unbekannter Fehler')
      setStatus({ type: 'success', msg: `✓ ${json.count} Projekte synchronisiert.` })
    } catch (err) {
      setStatus({ type: 'error', msg: 'Sync fehlgeschlagen: ' + String(err) })
    }
    setSyncing(false)
  }

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        ProSonata Synchronisierung
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        Projekte werden automatisch stündlich vom Server synchronisiert. Bei Bedarf hier manuell aktualisieren.
      </p>
      <div className="border border-border p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="border border-border text-white px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors disabled:opacity-40 whitespace-nowrap"
        >
          {syncing ? 'Synchronisiere…' : '↻ Jetzt synchronisieren'}
        </button>
        <p className="text-muted font-opensans text-xs">
          Lädt alle Projekte erneut aus ProSonata und aktualisiert die App.
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
                  style={{ textAlign: 'center', textAlignLast: 'center' }}
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
