import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies /api to siddhamind-core rather than the browser
// calling :8080 directly. That keeps the page and the API on one origin, so
// the JSESSIONID cookie is first-party and needs no SameSite=None (which
// would require HTTPS, which dev does not have). CORS is configured on the
// Java side as well, for the case where the client is served elsewhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        // Java is mounted under a context path; the client never says so.
        rewrite: (p) => '/siddhamind' + p,
        // ...but the session cookie comes back scoped to that context path,
        // as `Path=/siddhamind`. The client only ever requests /api/*, so a
        // cookie scoped to /siddhamind is never sent again: sign-in appears
        // to succeed and the very next call is 401. Rewriting the path to /
        // is what makes the session usable from this origin.
        cookiePathRewrite: { '/siddhamind': '/', '*': '/' },
      },
    },
  },
})
