import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    // Rechenkern direkt aus den Quellen einbinden – derselbe Code wie auf dem Server
    alias: { '@infrarot/rechenkern': fileURLToPath(new URL('../rechenkern/src/index.ts', import.meta.url)) },
  },
  server: { fs: { allow: ['..'] } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Infrarot-Planer',
        short_name: 'IR-Planer',
        description: 'Vor-Ort-Planung von Infrarot-Deckenmodulen – funktioniert auch ohne Netz',
        lang: 'de',
        id: '/',
        scope: '/',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1f3a6e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Die App selbst kommt ohne Netz aus dem Cache (index.html für jede Seite).
        // API-Aufrufe nie aus dem Cache beantworten – Offline-Daten liegen in IndexedDB (src/offline/).
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
