import { Trash2, X } from 'lucide-react'
import { useEffect } from 'react'
import { PRIORITIES, type Task, type TaskPatch } from '../../shared/types'
import { Checkbox } from './ui'

const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' }

// Side panel with all details of one task. Every change is saved right away.
export function TaskPanel(props: {
  task: Task
  onChange: (patch: TaskPatch) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { task, onChange, onClose } = props

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="task-panel" aria-label="Task details">
      <div className="panel-bar">
        <Checkbox checked={task.done} onChange={(done) => onChange({ done })} label="Done" />
        <span className="panel-state">{task.done ? 'Done' : 'Open'}</span>
        <button type="button" className="icon-button" title="Delete task" onClick={props.onDelete}>
          <Trash2 size={16} />
        </button>
        <button type="button" className="icon-button" title="Close (Esc)" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {/* A text area so a long title wraps instead of being cut off. It is still one line of text. */}
      <textarea
        className="panel-title"
        rows={1}
        value={task.title}
        placeholder="Title"
        maxLength={200}
        onChange={(event) => onChange({ title: event.target.value.replace(/\s*\n\s*/g, ' ') })}
        onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
        onBlur={() => task.title.trim() === '' && onChange({ title: 'Untitled' })}
      />

      <label className="field-label">Priority</label>
      <div className="segmented">
        {PRIORITIES.map((priority) => (
          <button
            key={priority}
            type="button"
            className={task.priority === priority ? `active priority-${priority}` : ''}
            onClick={() => onChange({ priority })}
          >
            {PRIORITY_LABEL[priority]}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="task-due">
        Due date
      </label>
      <div className="due-row">
        <input
          id="task-due"
          type="date"
          max="9999-12-31"
          value={task.dueDate ?? ''}
          onChange={(event) => onChange({ dueDate: event.target.value || null })}
        />
        {task.dueDate !== null && (
          <button type="button" className="text-button" onClick={() => onChange({ dueDate: null })}>
            Clear
          </button>
        )}
      </div>

      <label className="field-label" htmlFor="task-description">
        Description
      </label>
      <textarea
        id="task-description"
        className="panel-description"
        value={task.description}
        placeholder="Add more details…"
        onChange={(event) => onChange({ description: event.target.value })}
      />
    </aside>
  )
}
