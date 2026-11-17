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

function parseNote(json: string): JSONContent | null {
  try {
    return json === '' ? null : JSON.parse(json)
  } catch {
    return null
  }
}

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

function NoteEditor({ itemId, initial }: { itemId: number; initial: JSONContent | null }) {
  // Content that still has to be written to the database.
  const pending = useRef<{ json: string; text: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const editorRef = useRef<Editor | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write something… Try "# " for a heading, "- " for a list or "[ ] " for a checklist.' }),
      Markdown
    ],
    content: initial ?? '',
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
    onUpdate: ({ editor: current }) => {
      pending.current = { json: JSON.stringify(current.getJSON()), text: current.getText({ blockSeparator: '\n' }) }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        if (!pending.current) return
        api.saveNote(itemId, pending.current.json, pending.current.text)
        pending.current = null
      }, SAVE_DELAY_MS)
    }
  })
  editorRef.current = editor

  useEffect(() => {
    // The window is closing: only a blocking call is sure to arrive.
    const onUnload = (): void => {
      if (pending.current) api.saveNoteSync(itemId, pending.current.json, pending.current.text)
      pending.current = null
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      window.clearTimeout(timer.current)
      // Leaving the note: save what the timer did not save yet.
      if (pending.current) api.saveNote(itemId, pending.current.json, pending.current.text)
      pending.current = null
    }
  }, [itemId])

  return (
    <>
      <Toolbar editor={editor} />
      <div className="view-body note-body" onClick={(event) => event.target === event.currentTarget && editor.commands.focus('end')}>
        <EditorContent editor={editor} />
      </div>
    </>
  )
}

export function NoteView({ item, onUpdateItem }: ViewProps) {
  const [content, setContent] = useState<{ itemId: number; initial: JSONContent | null } | null>(null)

  useEffect(() => {
    let stale = false
    api.getNote(item.id).then((json) => !stale && setContent({ itemId: item.id, initial: parseNote(json) }))
    return () => {
      stale = true
    }
  }, [item.id])

  return (
    <div className="view">
      <ViewHeader item={item} onUpdateItem={onUpdateItem} />
      {content?.itemId === item.id && <NoteEditor key={item.id} itemId={item.id} initial={content.initial} />}
    </div>
  )
}
