import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, UPDATE_METHODS, type RendererApi, type UpdateState } from '../shared/types'

const api: Record<string, (...args: unknown[]) => unknown> = {
  saveNoteSync: (...args) => ipcRenderer.sendSync('api:sync', 'saveNote', args),
  writeFileTextSync: (...args) => ipcRenderer.sendSync('api:sync', 'writeFileText', args),
  pathOfFile: (file) => webUtils.getPathForFile(file as File),
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

const updates: Record<string, (...args: unknown[]) => unknown> = {
  onChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState): void =>
      (callback as (state: UpdateState) => void)(state)
    ipcRenderer.on('updates:changed', listener)
    return () => ipcRenderer.removeListener('updates:changed', listener)
  }
}
for (const method of UPDATE_METHODS) {
  updates[method] = (...args) => ipcRenderer.invoke(`updates:${method}`, ...args)
}

contextBridge.exposeInMainWorld('api', { ...api, updates } as unknown as RendererApi)
