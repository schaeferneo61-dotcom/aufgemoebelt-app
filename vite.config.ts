import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          xlsx: ['xlsx'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'logo.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'aufgemoebelt Warenwirtschaft',
        short_name: 'Warenwirtschaft',
        description: 'Warenwirtschaft für aufgemoebelt',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Sofort aktivieren – neue Version wird beim nächsten App-Start aktiv
        skipWaiting: true,
        clientsClaim: true,
        // Maximale Cache-Größe damit die App auch offline funktioniert
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          // ── Supabase REST API: NetworkFirst (offline: Cached-Daten anzeigen) ──
          {
            urlPattern: /^https:\/\/[a-z]+\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24, // 24 Stunden
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ── Supabase Auth: NetworkOnly (kein Cache für Auth-Token) ──
          {
            urlPattern: /^https:\/\/[a-z]+\.supabase\.co\/auth\/.*/i,
            handler: 'NetworkOnly',
          },
          // ── Supabase Storage (Produkt-Excel etc.) ──
          // NetworkFirst damit "↻ Excel aktualisieren" immer die neueste Datei lädt
          {
            urlPattern: /^https:\/\/[a-z]+\.supabase\.co\/storage\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-storage',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24, // 24h – nur Fallback bei Offline
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ── Google Fonts ──
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
})
