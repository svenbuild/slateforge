import { API_METHODS, type RendererApi } from '../../shared/types'

declare global {
  interface Window {
    // Set by the preload script inside the app window. Missing in a browser.
    api?: RendererApi
  }
}

const CHANGE_POLL_MS = 1000

// The same API for a normal browser: every call goes to the small web server
// of the app instead of the direct line that the app window has.
function browserApi(): RendererApi {
  // The change number of the data that this page has already seen.
  let seen = -1

  const call = async (method: string, args: unknown[], keepalive = false): Promise<unknown> => {
    const response = await fetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      keepalive
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    // The first answer sets the starting point. After that a step of exactly
    // one is the change this call made itself. A bigger step means someone
    // else changed something too, so the next poll reloads.
    const changes = Number(response.headers.get('X-Changes'))
    if (seen < 0 || changes === seen + 1) seen = changes
    return data.result
  }

  const api: Record<string, unknown> = {
    // The tab may be closing. `keepalive` lets the browser finish the request
    // (up to about 64 KB, a longer note is saved by the normal timer instead).
    saveNoteSync: (...args: unknown[]) => void call('saveNote', args, true).catch(() => {}),
    onExternalChange: (callback: () => void) => {
      const timer = window.setInterval(async () => {
        try {
          const changes = Number(await (await fetch('/changes')).text())
          if (seen >= 0 && changes > seen) callback()
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

// True when the app runs in a normal browser instead of its own window.
export const inBrowser = window.api === undefined

export const api: RendererApi = window.api ?? browserApi()
