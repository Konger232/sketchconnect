import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Shared links (/s/<id>) are the backend's page, as on the public site
    // (firebase.json sends them to Cloud Run).
    proxy: { '/s/': { target: 'http://localhost:8000', xfwd: true } },
  },
})
