// A small web server for an Actor's container URL: the built viewer as static
// files, plus whatever JSON routes the Actor adds. Apify publishes the port in
// ACTOR_WEB_SERVER_PORT at https://<run>.runs.apify.net and in the Live View tab.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.gz': 'application/gzip',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

export type Reply = { status?: number; json?: unknown; redirect?: string } | undefined;
export type Route = (req: http.IncomingMessage, url: URL, body: string) => Reply | Promise<Reply>;

export const sendJson = (res: http.ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};

export function serve(opts: { port: number; root: string; route?: Route; log?: (message: string) => void }) {
  const root = path.resolve(opts.root);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://container');
      const body = req.method === 'POST' ? await readBody(req) : '';
      const reply = await opts.route?.(req, url, body);
      if (reply?.redirect) {
        res.writeHead(302, { Location: reply.redirect, 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (reply) return sendJson(res, reply.status ?? 200, reply.json ?? null);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      const file = path.join(root, decodeURIComponent(url.pathname));
      // Nothing outside the viewer's folder, whatever the path says.
      if (file !== root && !file.startsWith(root + path.sep)) return sendJson(res, 404, { error: 'Not found' });
      const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
      if (!fs.existsSync(target)) return sendJson(res, 404, { error: 'Not found' });
      const hashed = url.pathname.startsWith('/assets/');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
    } catch (err) {
      opts.log?.(`web server: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
      else res.end();
    }
  });
  return new Promise<http.Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => resolve(server));
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf-8');
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 64_000) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
