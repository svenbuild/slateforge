import { Code, Eye } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { ViewHeader, type ViewProps } from './ui'

// Colors of the app that a page can use, as var(--bg), var(--text) and so on.
const THEME_COLORS = { bg: '--bg', surface: '--column', border: '--border', text: '--text', muted: '--text-muted', accent: '--accent' }

// The page runs in a locked frame of its own. This puts the colors of the
// current theme and a few basic styles in front of the HTML of the page.
function frameDocument(html: string): string {
  const style = getComputedStyle(document.documentElement)
  const colors = Object.entries(THEME_COLORS)
    .map(([name, source]) => `--${name}: ${style.getPropertyValue(source).trim()};`)
    .join(' ')
  // The rule in the first line lets the page use nothing but its own styles
  // and embedded images: no scripts, no files, nothing from the internet.
  // Links ask for a new window, which the main process hands to the browser.
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><base target="_blank"><style>
:root { color-scheme: ${style.colorScheme || 'dark'}; ${colors} }
body { margin: 0; padding: 20px 28px 40px; background: var(--bg); color: var(--text);
  font: 14px/1.55 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; }
h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.5em; }
h1 { font-size: 1.7em; } h2 { font-size: 1.3em; } h3 { font-size: 1.1em; }
body > :first-child { margin-top: 0; }
a { color: var(--accent); }
hr { border: none; border-top: 1px solid var(--border); margin: 1.4em 0; }
table { border-collapse: collapse; margin: 0.8em 0; }
th, td { border: 1px solid var(--border); padding: 6px 12px; text-align: left; vertical-align: top; }
th { background: var(--surface); }
code, pre { font-family: 'Cascadia Code', Consolas, monospace; font-size: 0.92em; }
pre { background: var(--surface); border: 1px solid var(--border); border-radius: 7px; padding: 10px 12px; overflow-x: auto; }
blockquote { margin: 0.8em 0; padding-left: 14px; border-left: 3px solid var(--border); color: var(--muted); }
img { max-width: 100%; }
</style>${html}`
}

// A page of free HTML. AI agents write these for summaries and reports, the
// user can read them here and change the HTML by hand.
export function PageView({ item, externalVersion, onUpdateItem }: ViewProps) {
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
  }, [item.id, externalVersion, editing])

  const change = (value: string): void => {
    setHtml(value)
    api.savePage(item.id, value)
  }

  return (
    <div className="view">
      <ViewHeader item={item} onUpdateItem={onUpdateItem}>
        <button type="button" className="ghost-button" onClick={() => setEditing(!editing)}>
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
        // Links may only ask for a new window.
        <iframe className="page-frame" title={item.title} sandbox="allow-popups" srcDoc={frameDocument(html)} />
      )}
    </div>
  )
}
