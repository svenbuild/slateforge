import { useEffect, useState } from 'react'
import { todayIso, treeRows } from '../../shared/logic'
import { ENTRY_TYPES, type Item, type ItemType, type Progress, type Task } from '../../shared/types'
import { api } from './api'
import { ItemIcon, TYPE_LABEL } from './icons'
import { Checkbox, TaskMeta } from './ui'

const DAYS_AHEAD = 7

function dateInDays(days: number): string {
  const day = new Date()
  day.setDate(day.getDate() + days)
  return todayIso(day)
}

// The folders an item is in, from the outside in, like "Work / Projects".
function folderPath(items: Item[], item: Item): string {
  const parent = items.find((other) => other.id === item.parentId)
  if (!parent) return ''
  const before = folderPath(items, parent)
  return before === '' ? parent.title : `${before} / ${parent.title}`
}

// Start page: what is due soon in all boards and lists, and how far each one is.
export function OverviewView(props: {
  items: Item[]
  progress: Progress[]
  version: number
  onOpen: (itemId: number, taskId?: number) => void
  onCreate: (type: ItemType) => void
  onTasksChanged: () => void
}) {
  const { items } = props
  const [due, setDue] = useState<Task[]>([])

  useEffect(() => {
    let stale = false
    api.listDueTasks(dateInDays(DAYS_AHEAD)).then((tasks) => !stale && setDue(tasks))
    return () => {
      stale = true
    }
  }, [props.version])

  const complete = (task: Task): void => {
    setDue((tasks) => tasks.filter((other) => other.id !== task.id))
    api.updateTask(task.id, { done: true })
    props.onTasksChanged()
  }

  const today = todayIso()
  const sections = [
    { title: 'Overdue', tasks: due.filter((task) => (task.dueDate ?? '') < today) },
    { title: 'Today', tasks: due.filter((task) => task.dueDate === today) },
    { title: `Next ${DAYS_AHEAD} days`, tasks: due.filter((task) => (task.dueDate ?? '') > today) }
  ].filter((section) => section.tasks.length > 0)

  const progressOf = new Map(props.progress.map((entry) => [entry.itemId, entry]))
  // All boards and lists in the order of the sidebar, also those in collapsed folders.
  const taskHolders = treeRows(items.map((item) => ({ ...item, collapsed: false })))
    .map((row) => row.item)
    .filter((item) => item.type === 'board' || item.type === 'list')

  if (!items.some((item) => item.type !== 'folder')) {
    return (
      <div className="empty-state">
        <h1>Welcome to Slateforge</h1>
        <p>Create a board, a list or a note to get started.</p>
        <div className="empty-actions">
          {ENTRY_TYPES.map((type) => (
            <button key={type} type="button" className="primary-button" onClick={() => props.onCreate(type)}>
              New {TYPE_LABEL[type].toLowerCase()}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>Overview</h1>
        <span className="overview-date">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </header>
      <div className="view-body overview-body">
        <section>
          <h2>Due soon</h2>
          {sections.length === 0 && <p className="empty-text">Nothing is due in the next {DAYS_AHEAD} days.</p>}
          {sections.map((section) => (
            <div key={section.title} className="due-group">
              <h3 className={section.title === 'Overdue' ? 'overdue' : ''}>
                {section.title}
                <span className="count">{section.tasks.length}</span>
              </h3>
              <ul className="task-list">
                {section.tasks.map((task) => {
                  const item = items.find((other) => other.id === task.itemId)
                  return (
                    <li key={task.id} className="task-row" onClick={() => props.onOpen(task.itemId, task.id)}>
                      <Checkbox checked={false} onChange={() => complete(task)} label={`Done: ${task.title}`} />
                      <span className="task-title">{task.title}</span>
                      {item && (
                        <span className="entry-chip">
                          <ItemIcon item={item} size={13} />
                          {item.title}
                        </span>
                      )}
                      <TaskMeta task={task} />
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>

        <section>
          <h2>Boards and lists</h2>
          {taskHolders.length === 0 && <p className="empty-text">No boards or lists yet.</p>}
          <ul className="progress-list">
            {taskHolders.map((item) => {
              const { total, done } = progressOf.get(item.id) ?? { total: 0, done: 0 }
              const path = folderPath(items, item)
              return (
                <li key={item.id} onClick={() => props.onOpen(item.id)}>
                  <ItemIcon item={item} />
                  <span className="progress-title">
                    {item.title}
                    {path !== '' && <span className="progress-path">{path}</span>}
                  </span>
                  <span className="progress-bar">
                    <span style={{ width: total === 0 ? 0 : `${(done / total) * 100}%` }} />
                  </span>
                  <span className="progress-text">{total === 0 ? 'No tasks' : `${done} of ${total} done`}</span>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
