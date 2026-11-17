import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startWebServer, type WebServer } from '../src/main/web'

let dir: string
let server: WebServer
let origin: string
let key: string
let changes = 0
const calls: [string, unknown[]][] = []

// A plain HTTP request, so the test can set headers a browser would not allow.
function send(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((done, fail) => {
    const call = request(origin + path, { method: options.method ?? 'GET', headers: options.headers }, (response) => {
      let body = ''
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => done({ status: response.statusCode ?? 0, headers: response.headers, body }))
    })
    call.on('error', fail)
    call.end(options.body)
  })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'slateforge-web-'))
  mkdirSync(join(dir, 'pages', 'assets'), { recursive: true })
  writeFileSync(join(dir, 'pages', 'index.html'), '<h1>app</h1>')
  writeFileSync(join(dir, 'pages', 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(dir, 'secret.html'), 'outside the pages folder')
  server = await startWebServer({
    root: join(dir, 'pages'),
    call: (method, args) => {
      if (method === 'explode') throw new Error('boom')
      calls.push([method, args])
      changes += 1
      return { echoed: args }
    },
    changes: () => changes
  })
  const address = new URL(server.address(12))
  origin = address.origin
  key = address.searchParams.get('key') as string
})

afterAll(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

const cookie = (): Record<string, string> => ({ Cookie: `slateforge_key=${key}` })

describe('web server', () => {
  it('listens on this computer only and puts the entry into the address', () => {
    expect(server.address(12)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?key=[0-9a-f]{48}#item=12$/)
  })

  it('turns the key in the address into a cookie', async () => {
    const response = await send(`/?key=${key}`)
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('/')
    expect(String(response.headers['set-cookie'])).toContain(`slateforge_key=${key}; HttpOnly; SameSite=Strict`)
  })

  it('refuses everything without the key', async () => {
    expect((await send('/')).status).toBe(403)
    expect((await send('/?key=wrong')).status).toBe(403)
    expect((await send('/assets/app.js')).status).toBe(403)
    expect((await send('/changes', { headers: { Cookie: 'slateforge_key=wrong' } })).status).toBe(403)
    expect((await send('/api/listItems', { method: 'POST', headers: { Origin: origin }, body: '[]' })).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('serves the pages of the app, and nothing outside their folder', async () => {
    expect((await send('/', { headers: cookie() })).body).toBe('<h1>app</h1>')
    const script = await send('/assets/app.js', { headers: cookie() })
    expect(script.headers['content-type']).toBe('text/javascript')
    expect((await send('/..%2Fsecret.html', { headers: cookie() })).status).toBe(404)
    expect((await send('/%2e%2e/secret.html', { headers: cookie() })).status).toBe(404)
    expect((await send('/missing.js', { headers: cookie() })).status).toBe(404)
  })

  it('runs API calls from its own pages and reports the change number', async () => {
    const response = await send('/api/updateTask', {
      method: 'POST',
      headers: { ...cookie(), Origin: origin },
      body: JSON.stringify([7, { done: true }])
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ result: { echoed: [7, { done: true }] } })
    expect(response.headers['x-changes']).toBe('1')
    expect(calls).toEqual([['updateTask', [7, { done: true }]]])
    expect((await send('/changes', { headers: cookie() })).body).toBe('1')
  })

  it('refuses API calls from other websites and under another name', async () => {
    const body = '[]'
    const other = await send('/api/emptyTrash', { method: 'POST', headers: { ...cookie(), Origin: 'https://evil.example' }, body })
    expect(other.status).toBe(403)
    const noOrigin = await send('/api/emptyTrash', { method: 'POST', headers: cookie(), body })
    expect(noOrigin.status).toBe(403)
    const otherName = await send('/', { headers: { ...cookie(), Host: 'evil.example' } })
    expect(otherName.status).toBe(403)
    expect(calls).toHaveLength(1)
  })

  it('reports failed calls and bad input as errors', async () => {
    const headers = { ...cookie(), Origin: origin }
    const failed = await send('/api/explode', { method: 'POST', headers, body: '[]' })
    expect(failed.status).toBe(500)
    expect(JSON.parse(failed.body)).toEqual({ error: 'boom' })
    expect((await send('/api/listItems', { method: 'POST', headers, body: '{"not":"a list"}' })).status).toBe(500)
    expect((await send('/api/listItems', { method: 'POST', headers, body: 'nonsense' })).status).toBe(500)
  })
})
