import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      sizes: [512],
      padding: 0.3,
      resizeOptions: { background: '#0A0A0B' },
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { background: '#0A0A0B' },
    },
  },
  images: ['public/logo.svg'],
});
