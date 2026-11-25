import { CircleCheck, Columns3, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ItemType, TrashEntry } from '../../shared/types'
import { api } from './api'
import { ItemIcon, TYPE_LABEL } from './icons'

function describe(entry: TrashEntry): string {
  if (entry.kind === 'item') return TYPE_LABEL[entry.context as ItemType] + (entry.hasContent ? ' with content' : '')
  return `${entry.kind === 'task' ? 'Task' : 'Column'} in ${entry.context}`
}

// Everything that was deleted. `onChanged` tells the app to load its data again.
export function TrashView({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [entries, setEntries] = useState<TrashEntry[]>([])

  const reload = useCallback(() => api.listTrash().then(setEntries), [])
  useEffect(() => {
    reload()
  }, [reload, version])

  const act = async (action: Promise<void>): Promise<void> => {
    await action
    await reload()
    onChanged()
  }

  const purge = (entry: TrashEntry): void => {
    const what = entry.hasContent ? `"${entry.title}" and everything inside it` : `"${entry.title}"`
    if (window.confirm(`Delete ${what} forever? This cannot be undone.`)) act(api.purge(entry.kind, entry.id))
  }

  const empty = (): void => {
    if (window.confirm('Delete everything in the trash forever? This cannot be undone.')) act(api.emptyTrash())
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>Trash</h1>
        <div className="view-header-actions">
          {entries.length > 0 && (
            <button type="button" className="ghost-button danger" onClick={empty}>
              <Trash2 size={15} />
              Empty trash
            </button>
          )}
        </div>
      </header>
      <div className="view-body trash-body">
        {entries.length === 0 && <p className="empty-text">The trash is empty.</p>}
        <ul className="trash-list">
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`}>
              {entry.kind === 'item' && <ItemIcon item={{ type: entry.context as ItemType, icon: '', color: '' }} />}
              {entry.kind === 'column' && <Columns3 size={16} className="item-icon muted" />}
              {entry.kind === 'task' && <CircleCheck size={16} className="item-icon muted" />}
              <div className="trash-text">
                <span className="trash-title">{entry.title}</span>
                <span className="trash-context">
                  {describe(entry)} · deleted {new Date(entry.deletedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
              <button type="button" className="ghost-button" onClick={() => act(api.restore(entry.kind, entry.id))}>
                <RotateCcw size={15} />
                Restore
              </button>
              <button type="button" className="ghost-button danger" onClick={() => purge(entry)}>
                <Trash2 size={15} />
                Delete forever
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
