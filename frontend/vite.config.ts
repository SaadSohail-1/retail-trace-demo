
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const allowedHosts = [
    'parish-tumble-acts.ngrok-free.dev',
    ...(env.VITE_ALLOWED_HOSTS
      ?.split(',')
      .map((host) => host.trim())
      .filter(Boolean) ?? []),
  ]

  return {
    plugins: [react()],
    server: {
      allowedHosts,
      proxy: {
        '/api': {
          target: env.BACKEND_PROXY_TARGET ?? 'http://localhost:5001',
          changeOrigin: true,
        },
      },
    },
  }
})
