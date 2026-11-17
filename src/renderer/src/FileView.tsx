import { FolderOpen, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FileInfo } from '../../shared/types'
import { api, getViewBase } from './api'
import { TextEditor, type EditorSource } from './NoteView'
import { ViewHeader, cleanMessage, type ViewProps } from './ui'

// How often an open file is checked for changes made by other programs.
const WATCH_MS = 1500

// A Markdown file is edited as text and written back as Markdown.
const fileSource = (itemId: number): EditorSource => ({
  load: () => api.readFileText(itemId),
  parse: (text) => text,
  save: (editor, blocking, previous) => {
    const markdown = editor.getMarkdown()
    if (!blocking) return { stored: markdown, done: api.writeFileText(itemId, markdown, previous) }
    api.writeFileTextSync(itemId, markdown, previous)
    return { stored: markdown, done: null }
  }
})

// Shows a linked local file. Markdown can be edited, HTML and PDF are shown
// as they are. The file itself stays where it is on disk.
export function FileView({ item, version, onUpdateItem }: ViewProps) {
  const [info, setInfo] = useState<FileInfo | null>(null)
  // The Markdown text as it was first read. The editor follows later changes itself.
  const [text, setText] = useState<string | null>(null)
  const [base, setBase] = useState('')
  // Counts up to load an HTML or PDF file again after it changed on disk.
  const [reloads, setReloads] = useState(0)
  // Why the file cannot be shown, for example because it is too large.
  const [problem, setProblem] = useState('')
  // Counts up when the file changed on disk, so the editor reads it again.
  const [fileVersion, setFileVersion] = useState(0)

  useEffect(() => {
    let stale = false
    const load = async (): Promise<void> => {
      const [loaded, viewBase] = await Promise.all([api.getFileInfo(item.id), getViewBase()])
      setInfo(loaded)
      setBase(viewBase)
      setProblem('')
      if (!loaded.exists || loaded.kind !== 'markdown') return
      const markdown = await api.readFileText(item.id)
      if (!stale) setText((current) => current ?? markdown)
    }
    load().catch((error: unknown) => !stale && setProblem(error instanceof Error ? cleanMessage(error.message) : String(error)))
    return () => {
      stale = true
    }
  }, [item.id, version])

  // Looks at the file every moment. When another program changed it, the
  // view shows the new content by itself.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const now = await api.getFileInfo(item.id).catch(() => null)
      if (!now) return
      setInfo((before) => {
        if (!before || (before.modified === now.modified && before.exists === now.exists)) return before
        setFileVersion((current) => current + 1)
        setReloads((current) => current + 1)
        return now
      })
    }, WATCH_MS)
    return () => window.clearInterval(timer)
  }, [item.id])

  const address = info && `${base}file/${item.id}/${encodeURIComponent(info.name)}?reload=${reloads}`
  const framed = info?.exists && (info.kind === 'html' || info.kind === 'pdf')

  return (
    <div className="view">
      <ViewHeader item={item} onUpdateItem={onUpdateItem}>
        {framed && (
          <button type="button" className="icon-button" title="Load the file again" onClick={() => setReloads(reloads + 1)}>
            <RotateCw size={15} />
          </button>
        )}
        <button type="button" className="ghost-button" disabled={!info?.exists} onClick={() => api.openFile(item.id)}>
          <FolderOpen size={15} />
          Open with Windows
        </button>
      </ViewHeader>
      {info && (
        <div className="file-path">
          {info.path}
          {info.exists && info.kind === 'markdown' && !info.writable && ' (read only: network drive)'}
        </div>
      )}

      {problem !== '' && <p className="empty-text page-empty">{problem}</p>}
      {info && !info.exists && <p className="empty-text page-empty">This file was not found. It may have been moved or deleted.</p>}
      {info?.exists && info.kind === 'other' && (
        <p className="empty-text page-empty">This kind of file cannot be shown here. Use "Open with Windows".</p>
      )}
      {info?.exists && info.kind === 'markdown' && text !== null && (
        <TextEditor source={fileSource(item.id)} stored={text} version={version + fileVersion} readOnly={!info.writable} protect layoutKey={`table-columns-${item.id}`} />
      )}
      {/* An HTML file may run its scripts, but in a frame of its own that cannot reach the app. */}
      {info?.exists && info.kind === 'html' && address && (
        <iframe
          className="page-frame"
          title={item.title}
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
          src={address}
        />
      )}
      {info?.exists && info.kind === 'pdf' && address && <iframe className="page-frame" title={item.title} src={address} />}
    </div>
  )
}
