import { API_METHODS, type RendererApi } from '../../shared/types'

declare global {
  interface Window {
    // Set by the preload script inside the app window. Missing in a browser.
    api?: RendererApi
  }
}

const CHANGE_POLL_MS = 1000
const KEY_STORE = 'slateforge-key'

// The secret key comes in the address behind "#" when the app opens the
// browser. It is kept for this tab only and taken out of the address again.
function readKey(): string {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const fromAddress = params.get('key')
  if (fromAddress) {
    window.sessionStorage.setItem(KEY_STORE, fromAddress)
    params.delete('key')
    window.history.replaceState(null, '', `#${params}`)
  }
  return window.sessionStorage.getItem(KEY_STORE) ?? ''
}

// The same API for a normal browser: every call goes to the small web server
// of the app instead of the direct line that the app window has.
function browserApi(): RendererApi {
  const key = readKey()
  if (key === '') {
    // Without the key nothing can be loaded, so the app does not start at all.
    document.body.textContent = 'Open this page with the browser button inside Slateforge.'
    throw new Error('No key')
  }
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  // The change number of the data that this page has already seen.
  let seen = -1
  // Calls run one after the other, so an older save cannot overtake a newer one.
  let queue: Promise<unknown> = Promise.resolve()

  const request = async (method: string, args: unknown[], keepalive: boolean): Promise<unknown> => {
    const response = await fetch(`/api/${method}`, { method: 'POST', headers, body: JSON.stringify(args), keepalive })
    if (response.status === 403) throw new Error('This browser tab has no access. Open it again from Slateforge.')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    // When nobody else changed the data before this call, everything up to
    // its own change is known. Otherwise the next poll reloads.
    if (seen < 0 || Number(response.headers.get('X-Changes-Before')) === seen) {
      seen = Number(response.headers.get('X-Changes'))
    }
    return data.result
  }

  const call = (method: string, args: unknown[], keepalive = false): Promise<unknown> => {
    const result = queue.then(() => request(method, args, keepalive))
    queue = result.catch(() => {})
    return result
  }

  const api: Record<string, unknown> = {
    // The tab may be closing, so this save does not wait in the queue: it is
    // sent at once. `keepalive` lets the browser finish the request (up to
    // about 64 KB, a longer note is saved by the normal timer instead).
    saveNoteSync: (...args: unknown[]) => void request('saveNote', args, true).catch(() => {}),
    writeFileTextSync: (...args: unknown[]) => void request('writeFileText', args, true).catch(() => {}),
    onExternalChange: (callback: () => void) => {
      const timer = window.setInterval(async () => {
        try {
          const response = await fetch('/changes', { headers })
          // Before the first answer of the app there is nothing to compare with.
          if (!response.ok || seen < 0) return
          const changes = Number(await response.text())
          if (changes > seen) callback()
          seen = Math.max(seen, changes)
        } catch {
          // The app was closed. Nothing to load until it runs again.
        }
      }, CHANGE_POLL_MS)
      return () => window.clearInterval(timer)
    }
  }
  for (const method of API_METHODS) api[method] = (...args: unknown[]) => call(method, args)
  return api as unknown as RendererApi
}

// Start of the addresses that show pages and linked files in a frame. It
// never changes while the app runs, so it is asked for only once.
let viewBase: Promise<string> | undefined
export const getViewBase = (): Promise<string> => (viewBase ??= api.getViewBase())

// True when the app runs in a normal browser instead of its own window.
export const inBrowser = window.api === undefined

export const api: RendererApi = window.api ?? browserApi()
