import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': '/src' } },
  worker: { format: 'iife' },
  build: { target: 'es2022' }
})
