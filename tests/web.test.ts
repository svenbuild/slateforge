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
    changes: () => changes,
    view: (path) =>
      path === 'page/7'
        ? { status: 200, type: 'text/html; charset=utf-8', body: '<h1>page 7</h1>', policy: "default-src 'none'" }
        : { status: 404, type: 'text/plain', body: 'Not found' }
  })
  const address = new URL(server.address(12))
  origin = address.origin
  key = new URLSearchParams(address.hash.slice(1)).get('key') as string
})

afterAll(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

const withKey = (): Record<string, string> => ({ Authorization: `Bearer ${key}` })

describe('web server', () => {
  it('listens on this computer only and keeps the key out of what is sent', () => {
    // The part after "#" stays in the browser and is never sent to a server.
    expect(server.address(12)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#key=[0-9a-f]{48}&item=12$/)
  })

  it('refuses all data without the key and sets no cookie', async () => {
    expect((await send('/changes')).status).toBe(403)
    expect((await send('/changes', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(403)
    expect((await send('/changes', { headers: { Cookie: `slateforge_key=${key}` } })).status).toBe(403)
    expect((await send('/api/listItems', { method: 'POST', headers: { Origin: origin }, body: '[]' })).status).toBe(403)
    expect((await send('/api/listItems', { headers: withKey() })).status).toBe(404)
    expect((await send('/')).headers['set-cookie']).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('serves the pages of the app, and nothing outside their folder', async () => {
    const page = await send('/')
    expect(page.body).toBe('<h1>app</h1>')
    expect(page.headers['x-frame-options']).toBe('DENY')
    const script = await send('/assets/app.js')
    expect(script.headers['content-type']).toBe('text/javascript')
    expect((await send('/..%2Fsecret.html')).status).toBe(404)
    expect((await send('/%2e%2e/secret.html')).status).toBe(404)
    expect((await send('/missing.js')).status).toBe(404)
  })

  it('shows pages and files in frames under a second key that opens nothing else', async () => {
    const answer = await send('/api/getViewBase', { method: 'POST', headers: { ...withKey(), Origin: origin }, body: '[]' })
    const base = JSON.parse(answer.body).result as string
    expect(base).toMatch(/^\/view\/[0-9a-f]{48}\/$/)
    expect(base).not.toContain(key)
    const page = await send(base + 'page/7')
    expect(page.body).toBe('<h1>page 7</h1>')
    expect(page.headers['content-security-policy']).toBe("default-src 'none'")
    expect(page.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect((await send(base + 'page/8')).status).toBe(404)
    expect((await send('/view/wrong/page/7')).status).toBe(404)
    // the view key is no API key
    const viewKey = base.split('/')[2]
    expect((await send('/changes', { headers: { Authorization: `Bearer ${viewKey}` } })).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('runs API calls from its own pages and reports the change number', async () => {
    const response = await send('/api/updateTask', {
      method: 'POST',
      headers: { ...withKey(), Origin: origin },
      body: JSON.stringify([7, { done: true }])
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ result: { echoed: [7, { done: true }] } })
    expect(response.headers['x-changes-before']).toBe('0')
    expect(response.headers['x-changes']).toBe('1')
    expect(calls).toEqual([['updateTask', [7, { done: true }]]])
    expect((await send('/changes', { headers: withKey() })).body).toBe('1')
  })

  it('refuses API calls from other websites and under another name', async () => {
    const body = '[]'
    const other = await send('/api/emptyTrash', { method: 'POST', headers: { ...withKey(), Origin: 'https://evil.example' }, body })
    expect(other.status).toBe(403)
    const otherPort = await send('/api/emptyTrash', { method: 'POST', headers: { ...withKey(), Origin: 'http://127.0.0.1:1' }, body })
    expect(otherPort.status).toBe(403)
    const otherName = await send('/', { headers: { Host: 'evil.example' } })
    expect(otherName.status).toBe(403)
    expect(calls).toHaveLength(1)
  })

  it('reports failed calls and bad input as errors', async () => {
    const headers = { ...withKey(), Origin: origin }
    const failed = await send('/api/explode', { method: 'POST', headers, body: '[]' })
    expect(failed.status).toBe(500)
    expect(JSON.parse(failed.body)).toEqual({ error: 'boom' })
    expect((await send('/api/listItems', { method: 'POST', headers, body: '{"not":"a list"}' })).status).toBe(500)
    expect((await send('/api/listItems', { method: 'POST', headers, body: 'nonsense' })).status).toBe(500)
  })
})
