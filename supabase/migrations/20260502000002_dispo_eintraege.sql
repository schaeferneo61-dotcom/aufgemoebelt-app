-- Dispo-Einträge: manuelle Mitarbeiter-Zuteilung durch Admin/Projektleitung
CREATE TABLE IF NOT EXISTS dispo_eintraege (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  projekt_id  uuid REFERENCES projects(id) ON DELETE SET NULL,
  projekt_name text,
  is_internal boolean NOT NULL DEFAULT false,
  datum_von   date NOT NULL,
  datum_bis   date NOT NULL,
  notiz       text,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT datum_von_lte_bis CHECK (datum_von <= datum_bis)
);

ALTER TABLE dispo_eintraege ENABLE ROW LEVEL SECURITY;

-- Alle eingeloggten Benutzer dürfen lesen
CREATE POLICY "Dispo lesen"
  ON dispo_eintraege FOR SELECT
  USING (auth.role() = 'authenticated');

-- Nur Admin / Projektleiter dürfen schreiben
CREATE POLICY "Dispo verwalten"
  ON dispo_eintraege FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.rolle IN ('admin', 'projektleiter')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.rolle IN ('admin', 'projektleiter')
    )
  );
