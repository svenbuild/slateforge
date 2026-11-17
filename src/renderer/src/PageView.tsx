import { Code, Eye } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, getViewBase } from './api'
import { ViewHeader, type ViewProps } from './ui'

// A page of free HTML in the house style. AI agents write these for summaries
// and reports, the user can read them here and change the HTML by hand.
export function PageView({ item, version, onUpdateItem }: ViewProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [base, setBase] = useState('')
  // The frame loads the page from the app by its address. This number goes
  // into the address and counts up when there is new HTML to show.
  const [revision, setRevision] = useState(0)
  const shown = useRef<string | null>(null)

  // Loads the page, and again when another program changed the data. Not
  // while the user edits the HTML, so typing is never replaced.
  useEffect(() => {
    if (editing) return
    let stale = false
    Promise.all([api.getPage(item.id), getViewBase()]).then(([loaded, viewBase]) => {
      if (stale) return
      setHtml(loaded)
      setBase(viewBase)
      if (loaded !== shown.current) {
        shown.current = loaded
        setRevision((current) => current + 1)
      }
    })
    return () => {
      stale = true
    }
  }, [item.id, version, editing])

  const change = (value: string): void => {
    setHtml(value)
    api.savePage(item.id, value)
  }

  return (
    <div className="view">
      <ViewHeader item={item} onUpdateItem={onUpdateItem}>
        <button type="button" className="ghost-button" disabled={html === null} onClick={() => setEditing(!editing)}>
          {editing ? <Eye size={15} /> : <Code size={15} />}
          {editing ? 'Show page' : 'Edit HTML'}
        </button>
      </ViewHeader>
      {html !== null && editing && (
        <textarea
          className="page-source"
          value={html}
          spellCheck={false}
          placeholder="<h1>Title</h1>&#10;<p>Write HTML here.</p>"
          onChange={(event) => change(event.target.value)}
        />
      )}
      {html !== null && !editing && html.trim() === '' && (
        <p className="empty-text page-empty">This page is empty. Use "Edit HTML" to write it, or let an AI agent fill it.</p>
      )}
      {html !== null && !editing && html.trim() !== '' && (
        // The page may run its own scripts, but in a frame of its own: it
        // cannot reach the app and cannot load anything from the internet.
        // Links may only ask for a new window, which opens the normal browser.
        <iframe
          className="page-frame"
          title={item.title}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          src={`${base}page/${item.id}?revision=${revision}`}
        />
      )}
    </div>
  )
}
