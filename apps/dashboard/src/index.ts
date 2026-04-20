import { parseEnv } from '@/env';
import { getTrending, parseWindow } from '@/trending';
import { makeDBClient } from '@modules/db';
import { makeLogger } from '@modules/logger';
import { makeTracer } from '@modules/tracing';
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version;
const COMMIT = Bun.env['COMMIT_SHA'] ?? 'unknown';

const Env = parseEnv(process.env);

const logger = makeLogger({ name: 'dashboard' });
const tracer = makeTracer({
  serviceName: 'dashboard',
  exporterUrls: Env.TRACE_EXPORTER_URLS,
  deploymentEnvironment: Env.NODE_ENV,
  logger,
});

const db = makeDBClient({ url: Env.DATABASE_URL, tracer });

function renderHtml(
  rows: { ticker: string; count: number; sources: string[] }[],
  window: string,
): string {
  const rows_html = rows
    .map(
      (r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>$${r.ticker}</strong></td>
      <td>${r.count}</td>
      <td>${r.sources.join(', ')}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Trending Tickers — acovado.club</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p.subtitle { color: #666; margin-bottom: 1.5rem; font-size: 0.9rem; }
    nav { margin-bottom: 1.5rem; }
    nav a { margin-right: 1rem; text-decoration: none; color: #0070f3; }
    nav a.active { font-weight: bold; border-bottom: 2px solid #0070f3; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; border-bottom: 2px solid #ddd; padding: 0.5rem 0.75rem; font-size: 0.85rem; text-transform: uppercase; color: #888; }
    td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #f0f0f0; }
    tr:last-child td { border-bottom: none; }
    td:first-child { color: #aaa; font-size: 0.85rem; }
    td:nth-child(3) { font-variant-numeric: tabular-nums; }
    .empty { color: #999; padding: 2rem 0; }
  </style>
</head>
<body>
  <h1>Trending Tickers</h1>
  <p class="subtitle">Top 20 most-mentioned tickers in the last ${window === '7d' ? '7 days' : '24 hours'}.</p>
  <nav>
    <a href="/?window=24h" class="${window !== '7d' ? 'active' : ''}">24h</a>
    <a href="/?window=7d" class="${window === '7d' ? 'active' : ''}">7d</a>
  </nav>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Ticker</th>
        <th>Mentions</th>
        <th>Sources</th>
      </tr>
    </thead>
    <tbody>
      ${rows_html || '<tr><td colspan="4" class="empty">No data for this window.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
}

const server = Bun.serve({
  port: Env.PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return tracer.with('GET /health', async (ctx) => {
        ctx.annotate('http.route', '/health');
        ctx.log.info({ method: req.method }, 'health check');
        return Response.json({
          status: 'ok',
          service: 'dashboard',
          version: VERSION,
          commit: COMMIT,
        });
      });
    }

    if (url.pathname === '/api/trending') {
      return tracer.with('GET /api/trending', async (ctx) => {
        const windowParam = url.searchParams.get('window');
        const windowMs = parseWindow(windowParam);
        ctx.annotate('http.route', '/api/trending');
        ctx.annotate('trending.window', windowParam ?? '24h');

        const rows = await getTrending(db, windowMs);
        ctx.log.info({ count: rows.length, window: windowParam }, 'trending fetched');
        return Response.json(rows);
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      return tracer.with('GET /', async (ctx) => {
        const windowParam = url.searchParams.get('window') ?? '24h';
        const windowMs = parseWindow(windowParam);
        ctx.annotate('http.route', '/');
        ctx.annotate('trending.window', windowParam);

        const rows = await getTrending(db, windowMs);
        ctx.log.info(
          { count: rows.length, window: windowParam },
          'trending page rendered',
        );
        return new Response(renderHtml(rows, windowParam), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      });
    }

    return new Response('Not found', { status: 404 });
  },
});

logger.info({ port: server.port }, 'dashboard server listening');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'dashboard: shutting down');
  server.stop();
  await tracer.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
