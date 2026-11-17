import { Check, Flag } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { makeSnippet, todayIso } from '../../shared/logic'
import type { Item, ItemPatch, Task, TaskPatch, Theme, TrashKind } from '../../shared/types'
import { api } from './api'
import { ItemIcon } from './icons'

export interface Deleted {
  kind: TrashKind
  id: number
  title: string
}

// Props shared by the board, list and note views.
export interface ViewProps {
  item: Item
  // Changes when data was restored from the trash, so views load again.
  version: number
  // Set when a search result asks to open a task.
  focusTask: { taskId: number } | null
  onUpdateItem: (patch: ItemPatch) => void
  onDeleted: (deleted: Deleted) => void
}

// Light and dark follow the color scheme that the main process sets. The
// attribute lets the style sheet tell the black theme apart from the dark one.
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

// Text that turns into an input. Enter or leaving the field saves, Escape cancels.
export function InlineEdit(props: {
  value: string
  editing: boolean
  onEditing: (editing: boolean) => void
  onCommit: (value: string) => void
  className?: string
}) {
  const [draft, setDraft] = useState(props.value)
  const cancelled = useRef(false)

  useEffect(() => {
    if (props.editing) {
      setDraft(props.value)
      cancelled.current = false
    }
  }, [props.editing, props.value])

  if (!props.editing) {
    return (
      <span className={`inline-text ${props.className ?? ''}`} onDoubleClick={() => props.onEditing(true)}>
        {props.value}
      </span>
    )
  }

  const finish = (): void => {
    const value = draft.trim()
    if (!cancelled.current && value !== '' && value !== props.value) props.onCommit(value)
    props.onEditing(false)
  }

  return (
    <input
      className={`inline-input ${props.className ?? ''}`}
      value={draft}
      autoFocus
      maxLength={200}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancelled.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}

// Title bar above a board, list or note. The title can be renamed with a double click.
export function ViewHeader({ item, onUpdateItem, children }: Pick<ViewProps, 'item' | 'onUpdateItem'> & { children?: ReactNode }) {
  const [editing, setEditing] = useState(false)
  return (
    <header className="view-header">
      <ItemIcon item={item} size={22} />
      <h1>
        <InlineEdit
          value={item.title}
          editing={editing}
          onEditing={setEditing}
          onCommit={(title) => onUpdateItem({ title })}
        />
      </h1>
      <div className="view-header-actions">{children}</div>
    </header>
  )
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`check ${checked ? 'checked' : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!checked)
      }}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </button>
  )
}

export function formatDue(date: string): string {
  const today = todayIso()
  const shifted = (days: number): string => {
    const day = new Date()
    day.setDate(day.getDate() + days)
    return todayIso(day)
  }
  if (date === today) return 'Today'
  if (date === shifted(1)) return 'Tomorrow'
  if (date === shifted(-1)) return 'Yesterday'
  const [year, month, day] = date.split('-').map(Number)
  const sameYear = year === new Date().getFullYear()
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric'
  })
}

// Small line below a task title: priority (only when not medium) and due date.
export function TaskMeta({ task }: { task: Task }) {
  const overdue = task.dueDate !== null && !task.done && task.dueDate < todayIso()
  if (task.priority === 'medium' && task.dueDate === null) return null
  return (
    <span className="task-meta">
      {task.priority !== 'medium' && (
        <span className={`pill priority-${task.priority}`}>
          <Flag size={11} />
          {task.priority === 'high' ? 'High' : 'Low'}
        </span>
      )}
      {task.dueDate !== null && <span className={`pill ${overdue ? 'overdue' : ''}`}>{formatDue(task.dueDate)}</span>}
    </span>
  )
}

// Marks the first match of the query inside a text.
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = makeSnippet(text, query, 1000)
  return (
    <>
      {parts.before}
      {parts.match && <mark>{parts.match}</mark>}
      {parts.after}
    </>
  )
}

// Keeps the selected task on screen, for example after opening a search result.
export function useScrollToSelected(selectedId: number | null, loaded: boolean): void {
  useEffect(() => {
    if (selectedId === null || !loaded) return
    document.querySelector('.task-row.selected, .card.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, loaded])
}

// Change and delete tasks in the local state and in the database.
export function useTaskActions(setTasks: Dispatch<SetStateAction<Task[]>>, onDeleted: (deleted: Deleted) => void) {
  const update = (id: number, patch: TaskPatch): void => {
    setTasks((tasks) => tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)))
    api.updateTask(id, patch)
  }
  const remove = async (task: Task): Promise<void> => {
    await api.deleteTask(task.id)
    setTasks((tasks) => tasks.filter((other) => other.id !== task.id))
    onDeleted({ kind: 'task', id: task.id, title: task.title })
  }
  return { update, remove }
}
