import { Code, Eye } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { pageDocument } from './export'
import { ViewHeader, type ViewProps } from './ui'

// A page of free HTML in the house style. AI agents write these for summaries
// and reports, the user can read them here and change the HTML by hand.
export function PageView({ item, version, onUpdateItem }: ViewProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  // Loads the page, and again when another program changed the data. Not
  // while the user edits the HTML, so typing is never replaced.
  useEffect(() => {
    if (editing) return
    let stale = false
    api.getPage(item.id).then((loaded) => !stale && setHtml(loaded))
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
        // The sandbox locks the frame: no scripts, no forms, no access to the app.
        // Links may only ask for a new window, which opens the normal browser.
        <iframe className="page-frame" title={item.title} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={pageDocument(item.title, html)} />
      )}
    </div>
  )
}
