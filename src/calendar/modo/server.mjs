import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import handler from './api/recommend.js';

const port = Number(process.env.PORT ?? 3000);
const publicFiles = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']], ['/map.js', ['map.js', 'text/javascript']],
  ['/scenario.js', ['scenario.js', 'text/javascript']], ['/calendar.js', ['calendar.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']]
]);

createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1');
    if (url.pathname === '/api/recommend') {
      const canHaveBody = !['GET', 'HEAD'].includes(incoming.method);
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(canHaveBody && { body: Readable.toWeb(incoming), duplex: 'half' })
      });
      const response = await handler.fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = publicFiles.get(url.pathname);
    if (!file || !['GET', 'HEAD'].includes(incoming.method)) {
      outgoing.writeHead(404).end();
      return;
    }
    const body = await readFile(new URL(`./public/${file[0]}`, import.meta.url));
    outgoing.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` });
    outgoing.end(incoming.method === 'HEAD' ? undefined : body);
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`modo · http://127.0.0.1:${port}`));
