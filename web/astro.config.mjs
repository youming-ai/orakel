// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

const apiTarget = process.env.API_URL || 'http://localhost:9999';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/api': apiTarget,
      },
      host: true,
      allowedHosts: true,
    },
  },
  integrations: [react()],
});