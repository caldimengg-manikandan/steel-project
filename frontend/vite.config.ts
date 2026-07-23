import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Development uses root, production uses '/steel/' prefix
  base: command === 'serve' ? '/' : '/steel/',
  plugins: [react()],
  server: {
    proxy: {
      '/steel/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steel\/api/, '/api'),
        timeout: 1800000,
        proxyTimeout: 1800000,
      },
      '/steel/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steel\/uploads/, '/uploads'),
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        timeout: 1800000,
        proxyTimeout: 1800000,
      },
    },
  },
  preview: {
    proxy: {
      '/steel/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steel\/api/, '/api'),
        timeout: 1800000,
        proxyTimeout: 1800000,
      },
      '/steel/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steel\/uploads/, '/uploads'),
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        timeout: 1800000,
        proxyTimeout: 1800000,
      },
    },
  },
}))
