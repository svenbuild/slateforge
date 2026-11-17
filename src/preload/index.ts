import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type RendererApi } from '../shared/types'

const api: Record<string, (...args: unknown[]) => unknown> = {
  saveNoteSync: (...args) => ipcRenderer.sendSync('api:sync', 'saveNote', args),
  writeFileTextSync: (...args) => ipcRenderer.sendSync('api:sync', 'writeFileText', args),
  // Returns a function that stops the calls again.
  onExternalChange: (callback) => {
    const listener = (): void => (callback as () => void)()
    ipcRenderer.on('external-change', listener)
    return () => ipcRenderer.removeListener('external-change', listener)
  }
}
for (const method of API_METHODS) {
  api[method] = (...args) => ipcRenderer.invoke(`api:${method}`, ...args)
}

contextBridge.exposeInMainWorld('api', api as unknown as RendererApi)
