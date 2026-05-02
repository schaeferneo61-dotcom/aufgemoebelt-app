import { supabase } from './supabase'

interface LogParams {
  product_id: string
  product_name: string
  project_id: string
  project_name: string
  aktion: 'ausgebucht' | 'eingebucht' | 'menge_geaendert' | 'excel_import'
  menge_delta: number
  user_id: string | null
  user_name: string | null
}

/** Schreibt eine Lagerbewegung ins Audit-Log. Fehler werden still ignoriert. */
export async function logLagerBewegung(params: LogParams): Promise<void> {
  try {
    await supabase.from('lager_bewegungen').insert({
      product_id: params.product_id,
      product_name: params.product_name,
      project_id: params.project_id,
      project_name: params.project_name,
      aktion: params.aktion,
      menge_delta: params.menge_delta,
      user_id: params.user_id,
      user_name: params.user_name,
    })
  } catch {
    // Audit-Log-Fehler sollen die eigentliche Aktion nie blockieren
  }
}

/** Ruft die DB-Funktion auf, um verfuegbar für ein einzelnes Produkt neu zu berechnen. */
export async function recalcVerfuegbar(productId: string): Promise<void> {
  try {
    await supabase.rpc('recalc_verfuegbar', { pid: productId })
  } catch {
    // silent
  }
}

/** Berechnet verfuegbar für ALLE Produkte neu (nach Excel-Import o.Ä.). */
export async function recalcAlleVerfuegbar(): Promise<void> {
  try {
    const { data: products } = await supabase.from('products').select('id')
    if (!products || products.length === 0) return
    // Sequenziell um DB nicht zu überlasten
    for (const p of products) {
      await supabase.rpc('recalc_verfuegbar', { pid: p.id })
    }
  } catch {
    // silent
  }
}
