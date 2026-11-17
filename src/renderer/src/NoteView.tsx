import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
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

// The editor with its toolbar. `stored` is the content as it was loaded.
export function TextEditor(props: { source: EditorSource; stored: string; version: number; readOnly?: boolean }) {
  const { source } = props
  const initial = source.parse(props.stored)
  // What the note or file holds, as far as this editor knows.
  const stored = useRef(props.stored)
  // True while the editor has changes that are not in the database yet.
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const editorRef = useRef<Editor | null>(null)

  // Writes unsaved changes. `blocking` is for a closing window, where an
  // async call could get lost.
  const save = (blocking = false): void => {
    window.clearTimeout(timer.current)
    const current = editorRef.current
    if (!dirty.current || !current) return
    dirty.current = false
    const previous = stored.current
    const saved = source.save(current, blocking, previous)
    stored.current = saved.stored
    saved.done?.catch((error: unknown) => {
      // Still unsaved: the next change or closing the window tries again.
      dirty.current = true
      stored.current = previous
      throw error
    })
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write something… Try "# " for a heading, "- " for a list or "[ ] " for a checklist.' }),
      Markdown
    ],
    content: initial ?? '',
    ...(typeof initial === 'string' ? { contentType: 'markdown' as const } : {}),
    editable: !props.readOnly,
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
      dirty.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(save, SAVE_DELAY_MS)
    }
  })
  editorRef.current = editor

  // The data changed somewhere. Only when it was this text, and the
  // user is not in the middle of typing, the new text replaces the old one.
  useEffect(() => {
    let stale = false
    const before = stored.current
    source.load().then((json) => {
      // A save that happened while waiting makes this answer outdated.
      if (stale || dirty.current || stored.current !== before || json === before) return
      stored.current = json
      const content = source.parse(json)
      editor.commands.setContent(content ?? '', {
        emitUpdate: false,
        ...(typeof content === 'string' ? { contentType: 'markdown' as const } : {})
      })
    })
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
    <>
      {!props.readOnly && <Toolbar editor={editor} />}
      <div className="view-body note-body" onClick={(event) => event.target === event.currentTarget && editor.commands.focus('end')}>
        <EditorContent editor={editor} />
      </div>
    </>
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
