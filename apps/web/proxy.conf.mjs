// Proxy de `ng serve` (desarrollo): replica el origen único de nginx en producción.
const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default {
  '/api/ws': { target, ws: true, changeOrigin: true },
  '/api': { target, changeOrigin: true },
};
