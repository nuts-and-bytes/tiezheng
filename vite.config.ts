/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['logo.svg', 'apple-touch-icon-180x180.png'],
      workbox: {
        globPatterns: ['**/*.{js,wasm,css,html}', 'food-presets/*.webp'],
      },
      manifest: {
        name: '铁证 IRONPROOF',
        short_name: '铁证',
        description: '你练过的，都有铁证',
        lang: 'zh-CN',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0A0A0B',
        background_color: '#0A0A0B',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { chart: ['chart.js', 'react-chartjs-2'] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [...configDefaults.exclude, 'workers/**/*.worker.test.ts'],
    setupFiles: './src/test/setup.ts',
    alias: {
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwaRegisterMock.ts', import.meta.url),
      ),
    },
  },
});
