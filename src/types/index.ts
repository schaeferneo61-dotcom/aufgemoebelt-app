export interface Product {
  id: string
  produkt: string
  kategorie: string | null
  staerke_mm: string | null
  masse_mm: string | null
  m2_lfm: string | null
  haendler: string | null
  ek_preis: number | null
  vk_preis: number | null
  stk_palette: string | null
  bestand: number
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  beschreibung: string | null
  status: 'aktiv' | 'abgeschlossen' | 'pausiert'
  typ: 'intern' | 'extern'
  erstellt_von: string | null
  enddatum: string | null
  prosonata_id: string | null
  created_at: string
  updated_at: string
}

export interface ProjectItem {
  id: string
  project_id: string
  product_id: string
  product_name: string | null
  product_kategorie: string | null
  menge: number
  notiz: string | null
  hinzugefuegt_von: string | null
  created_at: string
  updated_at: string
  product?: Product
}

export interface Profile {
  id: string
  name: string | null
  rolle: 'admin' | 'projektleiter' | 'mitarbeiter'
  email?: string | null
  created_at: string
}

export interface ProjectWithItems extends Project {
  items?: ProjectItem[]
  item_count?: number
}
