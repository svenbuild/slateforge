import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type RendererApi } from '../shared/types'

const api: Record<string, (...args: unknown[]) => unknown> = {
  saveNoteSync: (...args) => ipcRenderer.sendSync('api:saveNoteSync', ...args)
}
for (const method of API_METHODS) {
  api[method] = (...args) => ipcRenderer.invoke(`api:${method}`, ...args)
}

contextBridge.exposeInMainWorld('api', api as unknown as RendererApi)
