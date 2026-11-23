import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { handleAI, handleSync, type Env } from './server/api.ts';

/** Serve /api/ai e /api/sync localmente (npm run dev e preview), com as mesmas regras da Vercel. */
function localApi(env: Env): Plugin {
  const mw: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    const path = (req.url ?? '').split('?')[0];
    const handler = path === '/api/ai' ? handleAI : path === '/api/sync' ? handleSync : null;
    if (!handler) return next();
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      try {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === 'GET' ? undefined : Buffer.concat(chunks) });
        const response = await handler(request, env);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
  };
  return {
    name: 'meu-treino-local-api',
    configureServer: (server) => void server.middlewares.use(mw),
    configurePreviewServer: (server) => void server.middlewares.use(mw),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') as Env;
  return {
    define: {
      // Só no "npm run dev": evita digitar o código de acesso no computador. O build nunca inclui o código.
      __DEV_ACCESS_CODE__: JSON.stringify(mode === 'development' ? env.APP_ACCESS_CODE ?? '' : ''),
    },
    plugins: [
      react(),
      localApi(env),
      VitePWA({
        registerType: 'autoUpdate',
        // O registro e a troca de versão ficam em src/lib/updates.ts.
        injectRegister: false,
        includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
        manifest: {
          name: 'Meu Treino',
          short_name: 'Meu Treino',
          description: 'Treino, dieta e resumo com IA',
          lang: 'pt-BR',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: '#f1f1f1',
          background_color: '#f1f1f1',
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Sem o registro automático do plugin estes dois ficam desligados: a versão nova ficaria esperando.
          skipWaiting: true,
          clientsClaim: true,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          maximumFileSizeToCacheInBytes: 3_000_000,
        },
      }),
    ],
  };
});
