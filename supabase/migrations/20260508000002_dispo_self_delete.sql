-- Mitarbeiter können ihre eigenen Dispo-Einträge entfernen
CREATE POLICY "Mitarbeiter können eigene Zuteilungen entfernen"
  ON dispo_eintraege FOR DELETE
  USING (auth.uid() = user_id);
