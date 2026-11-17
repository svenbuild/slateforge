import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

// Serves the app to a normal browser on this computer. The browser gets the
// same pages as the app window and calls the same API over HTTP.
//
// Who may use it: only programs on this computer (the server listens on
// 127.0.0.1). The pages themselves are no secret and need no key. The data
// is: every API call must send the secret key in a header. The browser gets
// the key in the part of the address after "#", which is never sent over the
// network, and keeps it for that one tab. No cookie is used, because cookies
// would also go to other web servers on this computer.

const MAX_BODY_BYTES = 30_000_000
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

export interface WebServerOptions {
  // Folder with the built pages of the app (index.html and assets).
  root: string
  // Runs one API method and returns its result.
  call: (method: string, args: unknown[]) => unknown
  // A number that grows with every change of the data.
  changes: () => number
}

export interface WebServer {
  // Address that opens the app in the browser, with the key included.
  address: (itemId: number) => string
  close: () => void
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        fail(new Error('Too much data'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
    request.on('error', fail)
  })
}

export function startWebServer(options: WebServerOptions): Promise<WebServer> {
  const key = randomBytes(24).toString('hex')
  const root = resolve(options.root)
  let origin = ''

  const send = (response: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}): void => {
    response.writeHead(status, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // No other page may show the app inside a frame.
      'X-Frame-Options': 'DENY',
      ...headers
    })
    response.end(body)
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // A website that points its own name at this computer is turned away here.
    if (`http://${request.headers.host}` !== origin) return send(response, 403, 'Forbidden')
    const url = new URL(request.url ?? '/', origin)
    const isData = url.pathname === '/changes' || url.pathname.startsWith('/api/')

    if (isData) {
      if (request.headers.authorization !== `Bearer ${key}`) return send(response, 403, 'Forbidden')
      // Only pages that came from this server may ask. (A page from elsewhere
      // could not send the key header anyway.)
      if (request.headers.origin !== undefined && request.headers.origin !== origin) return send(response, 403, 'Forbidden')
    }

    if (request.method === 'GET' && url.pathname === '/changes') return send(response, 200, String(options.changes()))

    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      try {
        const args: unknown = JSON.parse(await readBody(request))
        if (!Array.isArray(args)) throw new Error('Invalid arguments')
        // The call runs in one go, so these two numbers tell exactly whether
        // it changed the data itself.
        const before = options.changes()
        const result = options.call(url.pathname.slice('/api/'.length), args)
        return send(response, 200, JSON.stringify({ result: result ?? null }), {
          'Content-Type': 'application/json',
          'X-Changes-Before': String(before),
          'X-Changes': String(options.changes())
        })
      } catch (error) {
        return send(response, 500, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
          'Content-Type': 'application/json'
        })
      }
    }

    if (request.method === 'GET' && !isData) {
      // Only files inside the folder of the app pages.
      const file = resolve(join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)))
      const type = CONTENT_TYPES[extname(file)]
      if (file.startsWith(root + sep) && type) {
        try {
          return send(response, 200, await readFile(file), { 'Content-Type': type })
        } catch {
          // falls through to "not found"
        }
      }
    }
    send(response, 404, 'Not found')
  }

  return new Promise((ready, fail) => {
    const server = createServer((request, response) => {
      // If even the error answer cannot be sent, the connection is just closed.
      handle(request, response).catch(() => response.destroy())
    })
    server.on('error', fail)
    // Port 0 lets Windows pick a free port. 127.0.0.1 keeps other computers out.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') return fail(new Error('No port'))
      origin = `http://127.0.0.1:${address.port}`
      ready({
        address: (itemId) => `${origin}/#key=${key}&item=${itemId}`,
        close: () => server.close()
      })
    })
  })
}
