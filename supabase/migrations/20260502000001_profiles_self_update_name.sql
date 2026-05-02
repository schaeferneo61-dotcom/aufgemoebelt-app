-- Benutzer dürfen ihren eigenen Namen in der profiles-Tabelle selbst setzen.
-- Nur das Feld "name" – Rolle und ID können nicht selbst geändert werden.
CREATE POLICY "Benutzer können eigenen Namen setzen"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
