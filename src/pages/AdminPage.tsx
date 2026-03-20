import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Header } from '../components/Header'
import { parseProductExcel, exportAllProjectsToExcel } from '../lib/excel'
import type { Product, Profile, Project, ProjectItem } from '../types'
import { Navigate } from 'react-router-dom'

type ItemWithProduct = ProjectItem & { product: Product }

export function AdminPage() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />

  return (
    <div className="min-h-screen bg-black">
      <Header />
      <main className="max-w-6xl mx-auto px-4 pt-24 pb-16">
        <div className="border-b border-border pb-8 mb-10">
          <h1 className="font-raleway font-semibold text-white text-3xl uppercase tracking-widest">
            Administration
          </h1>
          <p className="text-muted font-opensans text-sm mt-1">
            Produktverwaltung, Benutzer und Exporte
          </p>
        </div>

        <div className="space-y-12">
          <ProductImport />
          <UserManagement />
          <ExportSection />
        </div>
      </main>
    </div>
  )
}

// ── Produkt-Import ───────────────────────────────────────────

function ProductImport() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [productCount, setProductCount] = useState<number | null>(null)

  useEffect(() => {
    supabase.from('products').select('id', { count: 'exact', head: true }).then(({ count }) => {
      setProductCount(count ?? 0)
    })
  }, [status])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setStatus(null)

    try {
      const products = await parseProductExcel(file)
      if (products.length === 0) throw new Error('Keine Produkte in der Datei gefunden')

      // Alle bestehenden löschen und neu einfügen
      await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      const { error } = await supabase.from('products').insert(products)

      if (error) throw new Error(error.message)
      setStatus({ type: 'success', msg: `${products.length} Produkte erfolgreich importiert.` })
    } catch (err) {
      setStatus({ type: 'error', msg: String(err) })
    }

    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        Produktliste importieren
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        Excel-Datei mit Spalten: Produkt, Stärke (mm), Maße (mm), m2/Lfm, Händler, EK-Preis netto/Stk., VK-Preis netto/Stk., Stk/Palette
        {productCount !== null && (
          <> · Aktuell <span className="text-white">{productCount}</span> Produkte gespeichert</>
        )}
      </p>

      <div className="border border-border p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="hidden"
          id="product-file"
        />
        <label
          htmlFor="product-file"
          className="cursor-pointer bg-white text-black px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors"
        >
          {importing ? 'Importiere...' : 'Excel-Datei wählen'}
        </label>
        <p className="text-muted font-opensans text-xs">
          Bestehende Produkte werden überschrieben.
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

function UserManagement() {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteRole, setInviteRole] = useState<'mitarbeiter' | 'admin'>('mitarbeiter')
  const [creating, setCreating] = useState(false)
  const [createStatus, setCreateStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

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
      setCreateStatus({ type: 'success', msg: `Benutzer "${inviteName}" wurde angelegt. Sie können sich nun einloggen.` })
      setInviteEmail('')
      setInviteName('')
      setInvitePassword('')
      setInviteRole('mitarbeiter')
      setTimeout(loadUsers, 1000)
    }
    setCreating(false)
  }

  async function changeRole(userId: string, role: 'admin' | 'mitarbeiter') {
    await supabase.from('profiles').update({ rolle: role }).eq('id', userId)
    loadUsers()
  }

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        Benutzerverwaltung
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        Mitarbeiter anlegen und Rollen verwalten
      </p>

      {/* Neuen Benutzer anlegen */}
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
              onChange={(e) => setInviteRole(e.target.value as 'mitarbeiter' | 'admin')}
              className="w-full bg-black border border-border text-white px-4 py-2.5 font-opensans text-sm focus:border-white outline-none transition-colors"
            >
              <option value="mitarbeiter">Mitarbeiter</option>
              <option value="admin">Administrator</option>
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

      {/* Benutzerliste */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted text-sm font-opensans">
          <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
          Lade Benutzer...
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {users.map((u) => (
            <div key={u.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="font-opensans text-sm text-white">{u.name ?? '(kein Name)'}</p>
                <p className="font-opensans text-xs text-muted">{new Date(u.created_at).toLocaleDateString('de-AT')}</p>
              </div>
              <select
                value={u.rolle}
                onChange={(e) => changeRole(u.id, e.target.value as 'admin' | 'mitarbeiter')}
                className="bg-black border border-border text-white px-3 py-1.5 font-opensans text-xs focus:border-white outline-none"
              >
                <option value="mitarbeiter">Mitarbeiter</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Export ───────────────────────────────────────────────────

function ExportSection() {
  const [exporting, setExporting] = useState(false)

  const handleExportAll = async () => {
    setExporting(true)
    const [{ data: projects }, { data: items }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at'),
      supabase.from('project_items').select('*, product:products(*)'),
    ])
    exportAllProjectsToExcel(
      (projects as Project[]) ?? [],
      (items as ItemWithProduct[]) ?? [],
    )
    setExporting(false)
  }

  return (
    <section>
      <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm mb-1">
        Daten exportieren
      </h2>
      <p className="text-muted font-opensans text-xs mb-6">
        Alle Projektdaten als Excel-Datei herunterladen
      </p>
      <div className="border border-border p-6 flex items-center gap-4">
        <button
          onClick={handleExportAll}
          disabled={exporting}
          className="bg-white text-black px-6 py-3 font-raleway text-xs uppercase tracking-widest hover:bg-muted transition-colors disabled:opacity-40"
        >
          {exporting ? 'Exportiere...' : 'Alle Projekte exportieren'}
        </button>
        <p className="text-muted font-opensans text-xs">
          Übersicht + je ein Tabellenblatt pro Projekt
        </p>
      </div>
    </section>
  )
}
