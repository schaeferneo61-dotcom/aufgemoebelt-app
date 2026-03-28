-- ============================================================
-- AUFGEMÖBELT APP – DATENBANK SCHEMA
-- In Supabase ausführen: SQL Editor → New Query → Run
-- ============================================================

-- Produkttabelle (aus Excel importiert)
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produkt     TEXT NOT NULL,
  staerke_mm  TEXT,
  masse_mm    TEXT,
  m2_lfm      TEXT,
  haendler    TEXT,
  ek_preis    NUMERIC(10,2),
  vk_preis    NUMERIC(10,2),
  stk_palette TEXT,
  bestand     INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Projekte
CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  beschreibung TEXT,
  status      TEXT DEFAULT 'aktiv' CHECK (status IN ('aktiv','abgeschlossen','pausiert')),
  erstellt_von UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Projektpositionen (welche Produkte in einem Projekt)
CREATE TABLE IF NOT EXISTS project_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  menge       NUMERIC(10,2) NOT NULL DEFAULT 1,
  notiz       TEXT,
  hinzugefuegt_von UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Benutzerprofile (Rolle: admin oder mitarbeiter)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT,
  rolle       TEXT DEFAULT 'mitarbeiter' CHECK (rolle IN ('admin','mitarbeiter')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Automatisch Profil anlegen wenn User sich registriert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, name, rolle)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'name', COALESCE(NEW.raw_user_meta_data->>'rolle', 'mitarbeiter'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Updated_at automatisch setzen
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS project_items_updated_at ON project_items;
CREATE TRIGGER project_items_updated_at BEFORE UPDATE ON project_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Produkte: Alle eingeloggten Nutzer können lesen, nur Admin darf schreiben
DROP POLICY IF EXISTS "Produkte lesen" ON products;
CREATE POLICY "Produkte lesen" ON products FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Produkte verwalten" ON products;
CREATE POLICY "Produkte verwalten" ON products FOR ALL TO authenticated
  USING ((SELECT rolle FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rolle FROM profiles WHERE id = auth.uid()) = 'admin');

-- Projekte: Alle sehen alle Projekte, alle können anlegen
DROP POLICY IF EXISTS "Projekte lesen" ON projects;
CREATE POLICY "Projekte lesen" ON projects FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Projekte anlegen" ON projects;
CREATE POLICY "Projekte anlegen" ON projects FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Projekte bearbeiten" ON projects;
CREATE POLICY "Projekte bearbeiten" ON projects FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Projekte löschen" ON projects;
CREATE POLICY "Projekte löschen" ON projects FOR DELETE TO authenticated
  USING (erstellt_von = auth.uid() OR (SELECT rolle FROM profiles WHERE id = auth.uid()) = 'admin');

-- Projektpositionen: Alle lesen, alle können hinzufügen/bearbeiten
DROP POLICY IF EXISTS "Items lesen" ON project_items;
CREATE POLICY "Items lesen" ON project_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Items anlegen" ON project_items;
CREATE POLICY "Items anlegen" ON project_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Items bearbeiten" ON project_items;
CREATE POLICY "Items bearbeiten" ON project_items FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Items löschen" ON project_items;
CREATE POLICY "Items löschen" ON project_items FOR DELETE TO authenticated
  USING (hinzugefuegt_von = auth.uid() OR (SELECT rolle FROM profiles WHERE id = auth.uid()) = 'admin');

-- Profile: Jeder sieht alle Profile, nur eigenes bearbeiten
DROP POLICY IF EXISTS "Profile lesen" ON profiles;
CREATE POLICY "Profile lesen" ON profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Eigenes Profil bearbeiten" ON profiles;
CREATE POLICY "Eigenes Profil bearbeiten" ON profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- ============================================================
-- REALTIME AKTIVIEREN
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE project_items;