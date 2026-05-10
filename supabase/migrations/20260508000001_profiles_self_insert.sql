-- Benutzer können bei der Selbstregistrierung ihr eigenes Profil anlegen.
-- Die Rolle wird immer als 'mitarbeiter' gesetzt – nur Admins können die Rolle ändern.
CREATE POLICY "Benutzer können eigenes Profil anlegen"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
