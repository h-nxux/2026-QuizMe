import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Serves api/*.ts on the Vite dev server with the same req/res shape Vercel gives the functions,
// so `npm run dev` works end to end without `vercel dev`.
function devApi(): Plugin {
  return {
    name: 'quizme-dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
        if (!/^[a-z-]+$/.test(name)) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString('utf8');
          const body = raw ? JSON.parse(raw) : undefined;
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          let status = 200;
          const shim = {
            status(code: number) {
              status = code;
              return shim;
            },
            json(data: unknown) {
              res.statusCode = status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
            },
          };
          await mod.default({ method: req.method, headers: req.headers, body }, shim);
        } catch (error) {
          console.error('[dev-api]', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose .env (incl. GEMINI_API_KEY) to the dev API functions, like Vercel does.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [react(), devApi()],
    server: { host: true },
  };
});
