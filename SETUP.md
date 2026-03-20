# Aufgemöbelt App – Einrichtungsanleitung

## Überblick

Die App ist eine **Progressive Web App (PWA)**. Das bedeutet:
- Kein App Store nötig
- Mitarbeiter öffnen einen Link und können die App direkt vom Browser-Startbildschirm installieren
- Funktioniert auf iOS (Safari) und Android (Chrome)

---

## Schritt 1: Supabase-Datenbank einrichten (kostenlos)

Supabase ist die Datenbank der App. Der kostenlose Plan reicht für ~100 Mitarbeiter völlig aus.

1. Gehe auf **https://supabase.com** und erstelle einen kostenlosen Account
2. Klicke auf **"New Project"**
   - Name: `aufgemoebelt`
   - Passwort: Ein sicheres Datenbankpasswort (notieren!)
   - Region: **Frankfurt (eu-central-1)**
3. Warte ca. 2 Minuten bis das Projekt bereit ist
4. Gehe zu **SQL Editor** → **New Query**
5. Kopiere den gesamten Inhalt der Datei `supabase/schema.sql` hinein
6. Klicke **Run** – fertig!

### Zugangsdaten notieren:
Gehe zu **Settings → API** und notiere:
- `Project URL` → das ist dein `VITE_SUPABASE_URL`
- `anon / public` Key → das ist dein `VITE_SUPABASE_ANON_KEY`

---

## Schritt 2: Umgebungsvariablen setzen

Öffne die Datei `.env` (eine Kopie von `.env.example`) und fülle sie aus:

```
VITE_SUPABASE_URL=https://DEIN-PROJEKT.supabase.co
VITE_SUPABASE_ANON_KEY=dein-anon-key-hier
```

---

## Schritt 3: App auf Vercel deployen (kostenlos, empfohlen)

Vercel hostet die App kostenlos mit eigenem Link.

1. Gehe auf **https://vercel.com** und registriere dich
2. Klicke **"New Project"**
3. Lade den App-Ordner hoch ODER verbinde ein GitHub-Repository
4. Unter **Environment Variables** die zwei Werte aus Schritt 2 eintragen
5. Klicke **Deploy**

→ Du bekommst einen Link wie: `https://aufgemoebelt-app.vercel.app`

**Diesen Link geben Sie Ihren Mitarbeitern!**

### Alternative: Netlify
Gleicher Prozess auf https://netlify.com – auch kostenlos.

---

## Schritt 4: Ersten Admin-Account anlegen

Nach dem Deployment:

1. Gehe auf deinen App-Link
2. Logg dich **nicht** ein – öffne stattdessen **Supabase → Authentication → Users**
3. Klicke **"Invite user"** oder **"Add user"**
   - E-Mail: deine E-Mail
   - Passwort: sicheres Passwort
4. Gehe dann zu **Table Editor → profiles**
5. Suche deinen Benutzer und setze `rolle` auf `admin`

Ab jetzt kannst du weitere Mitarbeiter direkt **in der App** unter **Admin → Benutzerverwaltung** anlegen.

---

## Schritt 5: Produktliste importieren

1. Logge dich als Admin ein
2. Gehe zu **Admin** (oben in der Navigation)
3. Klicke **"Excel-Datei wählen"** unter "Produktliste importieren"
4. Wähle deine Excel-Datei aus

**Spaltenformat der Excel-Datei:**
| Produkt | Stärke (mm) | Maße (mm) | m2/Lfm | Händler | EK-Preis netto/Stk. | VK-Preis netto/Stk. | Stk/Palette |
|---------|------------|-----------|--------|---------|---------------------|---------------------|------------|
| ...     | ...        | ...       | ...    | ...     | ...                 | ...                 | ...        |

Die erste Zeile muss die Spaltenüberschriften enthalten.

---

## Schritt 6: Mitarbeiter anlegen

1. Als Admin einloggen → **Admin → Benutzerverwaltung**
2. Name, E-Mail und Passwort eingeben → **"Benutzer anlegen"**
3. Den App-Link + Login-Daten an den Mitarbeiter schicken

---

## App installieren (für Mitarbeiter)

### iPhone / iPad (Safari):
1. App-Link in Safari öffnen
2. Unten auf **Teilen** (Rechteck mit Pfeil) tippen
3. **"Zum Home-Bildschirm"** wählen
4. → App-Icon mit aufgemöbelt Logo erscheint

### Android (Chrome):
1. App-Link in Chrome öffnen
2. Banner erscheint automatisch: **"App installieren"**
3. Oder: Menü (drei Punkte) → **"Zum Startbildschirm hinzufügen"**

---

## Was die App kann

### Für alle Mitarbeiter:
- Projekte sehen und erstellen
- Produkte aus der Produktliste zu Projekten hinzufügen (mit Menge und Notiz)
- Mengen direkt in der Projektansicht bearbeiten
- **Echtzeit-Sync**: Wenn zwei Mitarbeiter gleichzeitig arbeiten, sehen beide sofort alle Änderungen

### Nur für Admins:
- Produktliste aus Excel importieren
- Projektstatus ändern (Aktiv / Pausiert / Abgeschlossen)
- Projekte als Excel exportieren (pro Projekt oder alle auf einmal)
- Mitarbeiter anlegen und Rollen verwalten
- EK-Preise sind nur für Admins sichtbar

---

## Lokale Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# .env Datei ausfüllen (Supabase-Zugangsdaten)
cp .env.example .env

# Entwicklungsserver starten
npm run dev

# Produktions-Build erstellen
npm run build
```

---

## Kosten

| Service | Kosten |
|---------|--------|
| Supabase (Free Tier) | 0 € / Monat |
| Vercel (Hobby) | 0 € / Monat |
| **Gesamt** | **0 €** |

Der kostenlose Supabase-Plan unterstützt bis zu 50.000 aktive Nutzer/Monat und 500 MB Datenbank – für 100 Mitarbeiter mehr als ausreichend.

---

## Support

Bei Fragen zum Setup: Die App wurde mit Claude Code gebaut.
