import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { TableMap } from '@tiptap/pm/tables'
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Strikethrough,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { ViewHeader, type ViewProps } from './ui'

const SAVE_DELAY_MS = 400

// Plain text that is very likely Markdown: headings, lists, checklists, quotes,
// code fences, bold text or links.
const MARKDOWN_HINT = /^(#{1,6} |[-*+] |\d+\. |> |```)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/m

// A note that cannot be read must fail loudly. Opening it as an empty note
// would overwrite the stored text with the first keystroke.
// Notes written by the command line tool are stored as { markdown: "..." }.
// They come back as a string and the editor formats them.
function parseNote(json: string): JSONContent | string | null {
  if (json === '') return null
  const content = JSON.parse(json)
  return typeof content.markdown === 'string' ? content.markdown : content
}

// Where the text of an editor comes from and where it is saved: a note in
// the database or a Markdown file on disk.
export interface EditorSource {
  // Reads the stored form again, to notice changes made elsewhere.
  load: () => Promise<string>
  // Turns the stored form into editor content. A string is taken as Markdown.
  parse: (stored: string) => JSONContent | string | null
  // Saves the editor content. `previous` is the stored form before this
  // save. Returns the new stored form, and a promise that fails when the save
  // failed (null when the save cannot be waited for).
  save: (editor: Editor, blocking: boolean, previous: string) => { stored: string; done: Promise<unknown> | null }
}

// Notes are saved as the document of the editor plus plain text for the search.
const noteSource = (itemId: number): EditorSource => ({
  load: () => api.getNote(itemId),
  parse: parseNote,
  save: (editor, blocking) => {
    const json = JSON.stringify(editor.getJSON())
    const text = editor.getText({ blockSeparator: '\n' })
    if (!blocking) return { stored: json, done: api.saveNote(itemId, json, text) }
    api.saveNoteSync(itemId, json, text)
    return { stored: json, done: null }
  }
})

interface Tool {
  name: string
  title: string
  icon: LucideIcon
  attributes?: Record<string, unknown>
  run: (editor: Editor) => void
}

const TOOLS: Tool[] = [
  { name: 'heading', attributes: { level: 1 }, title: 'Heading 1 (# )', icon: Heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { name: 'heading', attributes: { level: 2 }, title: 'Heading 2 (## )', icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { name: 'heading', attributes: { level: 3 }, title: 'Heading 3 (### )', icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { name: 'bold', title: 'Bold (Ctrl+B)', icon: Bold, run: (e) => e.chain().focus().toggleBold().run() },
  { name: 'italic', title: 'Italic (Ctrl+I)', icon: Italic, run: (e) => e.chain().focus().toggleItalic().run() },
  { name: 'strike', title: 'Strikethrough', icon: Strikethrough, run: (e) => e.chain().focus().toggleStrike().run() },
  { name: 'bulletList', title: 'Bullet list (- )', icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
  { name: 'orderedList', title: 'Numbered list (1. )', icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { name: 'taskList', title: 'Checklist ([ ] )', icon: ListTodo, run: (e) => e.chain().focus().toggleTaskList().run() },
  { name: 'blockquote', title: 'Quote (> )', icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { name: 'codeBlock', title: 'Code block (```)', icon: Code, run: (e) => e.chain().focus().toggleCodeBlock().run() }
]

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => TOOLS.map((tool) => current.isActive(tool.name, tool.attributes))
  })
  return (
    <div className="note-toolbar">
      {TOOLS.map((tool, index) => (
        <button
          key={tool.title}
          type="button"
          title={tool.title}
          className={`icon-button ${active[index] ? 'active' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => tool.run(editor)}
        >
          <tool.icon size={16} />
        </button>
      ))}
    </div>
  )
}

// The letters of a text, without spaces, signs and digits. Two Markdown texts
// with the same letters say the same, however they are formatted.
const lettersOf = (text: string): string => text.replace(/[^\p{L}]/gu, '')

// True when the editor would not write back everything that is in the
// Markdown text, for example because the text holds HTML that it drops.
function losesText(editor: Editor, markdown: string): boolean {
  return lettersOf(editor.getMarkdown()) !== lettersOf(markdown)
}

// The Markdown writer turns every "&", "<" and ">" of the text into a code
// like "&gt;", so "a -> b" would come back as "a -&gt; b". Where the plain
// sign cannot be mistaken for HTML or a quote, it is written as it is.
function keepPlainSigns(editor: Editor): void {
  // The library keeps this function to itself, so its type is given here.
  const writer = editor.markdown as unknown as { encodeTextForMarkdown: (...args: unknown[]) => string } | undefined
  if (!writer) return
  const encode = writer.encodeTextForMarkdown.bind(writer)
  writer.encodeTextForMarkdown = (...args) =>
    encode(...args)
      // Not at the start, where ">" would begin a quote.
      .replace(/(?<=[^\n])&gt;/g, '>')
      // Not before a letter, "/", "!" or "?", where "<" would begin a tag.
      .replace(/&lt;(?![a-zA-Z/!?])/g, '<')
      // Not before something that reads as a code itself, like "&copy;".
      .replace(/&amp;(?!#?\w+;)/g, '&')
}

// A column that would start very wide is cut to this, the rest wraps.
const MAX_START_WIDTH = 420

// The column widths of every table in the text, table by table.
function columnWidths(editor: Editor): number[][] {
  const tables: number[][] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true
    const widths: number[] = []
    node.firstChild?.forEach((cell) => widths.push(...((cell.attrs.colwidth as number[] | null) ?? [])))
    tables.push(widths)
    return false
  })
  return tables
}

// Gives every table column a width of its own, so dragging one edge moves
// only that edge and the other columns stay as they are. A column without a
// width gets the remembered one, or else the width it has on screen now.
function fixColumnWidths(editor: Editor, remembered: number[][]): void {
  const { state, view } = editor
  const change = state.tr
  let tableIndex = 0
  state.doc.descendants((table, tablePosition) => {
    if (table.type.name !== 'table') return true
    // Measured without line breaks, so a column starts as wide as its
    // longest text needs (up to the limit), not squeezed by the window.
    const element = (view.nodeDOM(tablePosition) as HTMLElement | null)?.querySelector('table')
    if (element) element.style.whiteSpace = 'nowrap'
    const onScreen = Array.from(element?.querySelector('tr')?.children ?? [], (cell) =>
      Math.min(MAX_START_WIDTH, Math.ceil(cell.getBoundingClientRect().width) + 2)
    )
    if (element) element.style.whiteSpace = ''
    const known = remembered[tableIndex] ?? []
    const widths = known.length === onScreen.length ? known : onScreen
    tableIndex += 1
    // The map knows the real column of every cell. A first row with merged
    // cells does not show one cell per column, so such a table is left alone.
    const map = TableMap.get(table)
    if (onScreen.length !== map.width) return false
    table.forEach((row, rowOffset) => {
      row.forEach((cell, cellOffset) => {
        const inTable = rowOffset + 1 + cellOffset
        const span = (cell.attrs.colspan as number | undefined) ?? 1
        const column = map.colCount(inTable)
        const own = widths.slice(column, column + span)
        if (!cell.attrs.colwidth && own.length === span && own.every((width) => width > 0)) {
          change.setNodeMarkup(tablePosition + 1 + inTable, undefined, { ...cell.attrs, colwidth: own })
        }
      })
    })
    return false
  })
  if (change.docChanged) view.dispatch(change.setMeta('addToHistory', false))
}

function readRemembered(key: string | undefined): number[][] {
  try {
    return key ? JSON.parse(window.localStorage.getItem(key) ?? '[]') : []
  } catch {
    return []
  }
}

// The editor with its toolbar. `stored` is the content as it was loaded.
// With `protect`, a Markdown text that the editor cannot keep completely is
// only shown, never written back.
export function TextEditor(props: {
  source: EditorSource
  stored: string
  version: number
  readOnly?: boolean
  protect?: boolean
  // Name under which the column widths of tables are remembered on this
  // computer. For Markdown files, which cannot hold widths themselves.
  layoutKey?: string
}) {
  const { source } = props
  const initial = source.parse(props.stored)
  // What the note or file holds, as far as this editor knows.
  const stored = useRef(props.stored)
  // True while the editor has changes that are not in the database yet.
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const editorRef = useRef<Editor | null>(null)
  // True while new text is put into the editor.
  const loading = useRef(false)
  // The Markdown form of what the editor shows, to tell real changes of the
  // text from changes of the layout only. Used for Markdown files.
  const shown = useRef('')
  // True once the user has clicked or typed in the editor since the last
  // loading. Only then a change of the text is the user's and is saved.
  const touched = useRef(false)

  const markTouched = (): void => {
    touched.current = true
  }

  // Writes unsaved changes. `blocking` is for a closing window, where an
  // async call could get lost.
  const save = (blocking = false): void => {
    window.clearTimeout(timer.current)
    const current = editorRef.current
    if (!dirty.current || !current || locked.current) return
    dirty.current = false
    const shownBefore = shown.current
    if (props.layoutKey) {
      // Column widths of Markdown files are remembered here, not in the
      // file. If that fails, for example because the store is full, the
      // text is saved all the same.
      try {
        const widths = columnWidths(current)
        if (widths.length === 0) window.localStorage.removeItem(props.layoutKey)
        else window.localStorage.setItem(props.layoutKey, JSON.stringify(widths))
      } catch {
        // The widths are just not remembered.
      }
      // A new column width changes nothing in the Markdown text. Then there
      // is nothing to write to the file.
      const markdown = current.getMarkdown()
      if (markdown === shownBefore) return
      shown.current = markdown
    }
    const previous = stored.current
    const saved = source.save(current, blocking, previous)
    stored.current = saved.stored
    saved.done?.catch((error: unknown) => {
      // Still unsaved: the next change or closing the window tries again.
      dirty.current = true
      stored.current = previous
      shown.current = shownBefore
      throw error
    })
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // Columns can be made wider or narrower by dragging their edge.
      TableKit.configure({ table: { resizable: true, cellMinWidth: 60, handleWidth: 8 } }),
      Placeholder.configure({ placeholder: 'Write something… Try "# " for a heading, "- " for a list or "[ ] " for a checklist.' }),
      Markdown
    ],
    content: initial ?? '',
    ...(typeof initial === 'string' ? { contentType: 'markdown' as const } : {}),
    editable: !props.readOnly,
    onBeforeCreate: ({ editor: created }) => keepPlainSigns(created),
    editorProps: {
      attributes: { class: 'note-content', spellcheck: 'false' },
      // Plain Markdown text from the clipboard is turned into formatted content.
      handlePaste: (_view, event) => {
        const data = event.clipboardData
        const text = data?.getData('text/plain') ?? ''
        const hasHtml = (data?.getData('text/html') ?? '') !== '' && !data?.types.includes('vscode-editor-data')
        if (hasHtml || !MARKDOWN_HINT.test(text) || !editorRef.current) return false
        if (editorRef.current.isActive('codeBlock')) return false
        return editorRef.current.commands.insertContent(text, { contentType: 'markdown' })
      }
    },
    onUpdate: () => {
      // The editor may adjust the text by itself after loading, for example
      // the layout of a table. Only what follows an action of the user (a
      // click, a key, pasting or dropping something), and not the loading
      // itself, is a change to save.
      if (!touched.current || loading.current) return
      dirty.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(save, SAVE_DELAY_MS)
    }
  })
  editorRef.current = editor

  // Set when the editor would lose text. Then nothing is ever saved.
  const locked = useRef(false)
  const [lossy, setLossy] = useState(false)
  const protectText = (content: JSONContent | string | null): void => {
    locked.current = props.protect === true && typeof content === 'string' && losesText(editor, content)
    setLossy(locked.current)
    editor.setEditable(!props.readOnly && !locked.current)
  }
  // Puts loaded text in order: fixed column widths, and the lock if needed.
  const settle = (content: JSONContent | string | null): void => {
    const remembered = readRemembered(props.layoutKey)
    loading.current = true
    touched.current = false
    fixColumnWidths(editor, remembered)
    if (props.layoutKey) shown.current = editor.getMarkdown()
    // Adjustments that follow at once still belong to the loading.
    window.setTimeout(() => (loading.current = false), 0)
    protectText(content)
  }
  useEffect(() => settle(initial), [])

  // The data changed somewhere. Only when it was this text, and the
  // user is not in the middle of typing, the new text replaces the old one.
  useEffect(() => {
    let stale = false
    const before = stored.current
    source
      .load()
      .then((json) => {
        // A save that happened while waiting makes this answer outdated.
        if (stale || dirty.current || stored.current !== before || json === before) return
        stored.current = json
        const content = source.parse(json)
        loading.current = true
        editor.commands.setContent(content ?? '', {
          emitUpdate: false,
          ...(typeof content === 'string' ? { contentType: 'markdown' as const } : {})
        })
        settle(content)
      })
      // A text that cannot be read right now keeps what the editor shows. The
      // error must not count as a failed call, which would only load again.
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [props.version])

  // Save what the timer did not save yet when the window closes or the note is left.
  useEffect(() => {
    const onUnload = (): void => save(true)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      save()
    }
  }, [])

  return (
    <div
      className="editor"
      onPointerDownCapture={markTouched}
      onKeyDownCapture={markTouched}
      onPasteCapture={markTouched}
      onDropCapture={markTouched}
    >
      {!props.readOnly && !lossy && <Toolbar editor={editor} />}
      {lossy && (
        <p className="editor-notice">
          This file has parts that the editor cannot keep, for example HTML. It is shown read only, so nothing gets lost.
          Change it with "Open with Windows".
        </p>
      )}
      <div className="view-body note-body" onClick={(event) => event.target === event.currentTarget && editor.commands.focus('end')}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

export function NoteView({ item, version, onUpdateItem }: ViewProps) {
  // Null while the note is loading. The editor only exists with loaded content.
  const [json, setJson] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    api.getNote(item.id).then((loaded) => !stale && setJson(loaded))
    return () => {
      stale = true
    }
  }, [item.id])

  return (
    <div className="view">
      <ViewHeader item={item} onUpdateItem={onUpdateItem} />
      {json !== null && <TextEditor source={noteSource(item.id)} stored={json} version={version} />}
    </div>
  )
}
