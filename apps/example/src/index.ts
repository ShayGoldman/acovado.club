import { parseEnv } from '@/env';

const Env = parseEnv(process.env);
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';

const logger = makeLogger({ name: 'example' });
const tracer = makeTracer({
  serviceName: 'example',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  logger,
});

const server = Bun.serve({
  port: Env.PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return tracer.with('GET /health', async (ctx) => {
        ctx.annotate('http.route', '/health');
        ctx.log.info({ method: req.method }, 'health check');
        return Response.json({ status: 'ok', service: 'example' });
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      return Response.json({
        message: 'acovado.club example app',
        endpoints: { health: '/health' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
});

logger.info({ port: server.port }, 'example server listening');
