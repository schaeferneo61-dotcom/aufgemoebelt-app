import { supabase } from './supabase'
import { logLagerBewegung } from './lager'
import type { Product } from '../types'

// ── Typen ────────────────────────────────────────────────────

export interface OfflineBooking {
  id: string              // lokale UUID
  projectId: string
  projectName: string
  productId: string
  productName: string
  productKategorie: string | null
  product: Product        // vollständiges Produkt-Objekt für Anzeige
  menge: number
  notiz: string | null
  userId: string | null
  userName: string | null
  createdAt: string       // ISO-String
}

// ── Storage ──────────────────────────────────────────────────

const QUEUE_KEY = 'aufgemoebelt_offline_queue'

export function getQueue(): OfflineBooking[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function addToQueue(entry: OfflineBooking): void {
  const queue = getQueue()
  queue.push(entry)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function removeFromQueue(id: string): void {
  const queue = getQueue().filter(e => e.id !== id)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function getQueueForProject(projectId: string): OfflineBooking[] {
  return getQueue().filter(e => e.projectId === projectId)
}

export function getQueueCount(): number {
  return getQueue().length
}

// ── Sync beim Wiederherstellen der Verbindung ────────────────

export async function processQueue(): Promise<{ synced: number; rejected: string[] }> {
  const queue = getQueue()
  if (queue.length === 0) return { synced: 0, rejected: [] }

  // Prüfen welche Produkte + Projekte noch existieren
  const productIds = [...new Set(queue.map(e => e.productId))]
  const projectIds = [...new Set(queue.map(e => e.projectId))]

  const [{ data: existingProducts }, { data: existingProjects }] = await Promise.all([
    supabase.from('products').select('id').in('id', productIds),
    supabase.from('projects').select('id').in('id', projectIds),
  ])

  const validIds = new Set((existingProducts ?? []).map(p => p.id as string))
  const validProjectIds = new Set((existingProjects ?? []).map(p => p.id as string))

  let synced = 0
  const rejected: string[] = []

  for (const entry of queue) {
    // Produkt oder Projekt existiert nicht mehr → verwerfen
    if (!validIds.has(entry.productId) || !validProjectIds.has(entry.projectId)) {
      removeFromQueue(entry.id)
      rejected.push(entry.productName)
      continue
    }

    const { error } = await supabase.from('project_items').insert({
      project_id: entry.projectId,
      product_id: entry.productId,
      product_name: entry.productName,
      product_kategorie: entry.productKategorie,
      menge: entry.menge,
      notiz: entry.notiz,
      hinzugefuegt_von: entry.userId,
    })

    if (!error) {
      await logLagerBewegung({
        product_id: entry.productId,
        product_name: entry.productName,
        project_id: entry.projectId,
        project_name: entry.projectName,
        aktion: 'ausgebucht',
        menge_delta: -entry.menge,
        user_id: entry.userId,
        user_name: entry.userName,
      })
      removeFromQueue(entry.id)
      synced++
    }
  }

  return { synced, rejected }
}
