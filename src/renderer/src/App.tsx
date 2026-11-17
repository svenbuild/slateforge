import { Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ITEM_TYPES, type Item, type ItemPatch, type ItemType, type SearchResult } from '../../shared/types'
import { api } from './api'
import { BoardView } from './BoardView'
import { TYPE_LABEL } from './icons'
import { ListView } from './ListView'
import { NoteView } from './NoteView'
import { SearchDialog } from './SearchDialog'
import { SettingsView } from './SettingsView'
import { Sidebar } from './Sidebar'
import { TrashView } from './TrashView'
import { isEditable, type Deleted, type ViewProps } from './ui'

type View = { kind: 'item'; id: number } | { kind: 'settings' } | { kind: 'trash' } | { kind: 'empty' }

interface Toast {
  text: string
  canUndo: boolean
}

const TOAST_MS = 6000
const ITEM_VIEWS = { board: BoardView, list: ListView, note: NoteView }

export function App() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [view, setView] = useState<View>({ kind: 'empty' })
  const [focusTask, setFocusTask] = useState<{ taskId: number } | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  // Counts up when trashed data comes back, so the open view loads again.
  const [version, setVersion] = useState(0)
  // Deletes of this session, newest last. Undo restores the newest one.
  const undoStack = useRef<Deleted[]>([])

  const openItem = useCallback((id: number, taskId: number | null = null) => {
    setView({ kind: 'item', id })
    setFocusTask(taskId === null ? null : { taskId })
    api.setLastItem(id)
  }, [])

  useEffect(() => {
    Promise.all([api.listItems(), api.getSettings()]).then(([loaded, settings]) => {
      setItems(loaded)
      const startId = settings.lastItemId ?? loaded[0]?.id
      if (startId !== undefined) setView({ kind: 'item', id: startId })
    })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  // A failed database call must not leave the screen out of sync with the data.
  useEffect(() => {
    const onFailure = (event: PromiseRejectionEvent): void => {
      console.error(event.reason)
      setToast({ text: 'Something went wrong. The data was loaded again.', canUndo: false })
      api.listItems().then(setItems, () => {})
      setVersion((current) => current + 1)
    }
    window.addEventListener('unhandledrejection', onFailure)
    return () => window.removeEventListener('unhandledrejection', onFailure)
  }, [])

  const onDeleted = useCallback((deleted: Deleted) => {
    undoStack.current.push(deleted)
    setToast({ text: `Deleted "${deleted.title}"`, canUndo: true })
  }, [])

  const undo = useCallback(async () => {
    const last = undoStack.current.pop()
    if (!last) return
    await api.restore(last.kind, last.id)
    setItems(await api.listItems())
    setVersion((current) => current + 1)
    if (last.kind === 'item') openItem(last.id)
    setToast({ text: `Restored "${last.title}"`, canUndo: false })
  }, [openItem])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      } else if (key === 'z' && !event.shiftKey && !isEditable(event.target)) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  if (items === null) return null

  const createItem = async (type: ItemType): Promise<void> => {
    const item = await api.createItem(type, `New ${type}`)
    setItems((current) => [...(current ?? []), item])
    openItem(item.id)
    setRenamingId(item.id)
  }

  const updateItem = (id: number, patch: ItemPatch): void => {
    setItems((current) => (current ?? []).map((item) => (item.id === id ? { ...item, ...patch } : item)))
    api.updateItem(id, patch)
  }

  const reorderItems = (orderedIds: number[]): void => {
    setItems(orderedIds.map((id) => items.find((item) => item.id === id) as Item))
    api.setItemOrder(orderedIds)
  }

  const deleteItem = async (item: Item): Promise<void> => {
    await api.deleteItem(item.id)
    const remaining = items.filter((other) => other.id !== item.id)
    setItems(remaining)
    if (view.kind === 'item' && view.id === item.id) {
      if (remaining.length > 0) openItem(remaining[0].id)
      else {
        setView({ kind: 'empty' })
        api.setLastItem(null)
      }
    }
    onDeleted({ kind: 'item', id: item.id, title: item.title })
  }

  // Restoring or deleting forever in the trash makes the undo list outdated.
  const onTrashChanged = async (): Promise<void> => {
    undoStack.current = []
    setToast(null)
    setItems(await api.listItems())
    setVersion((current) => current + 1)
  }

  const openResult = (result: SearchResult): void => {
    setSearchOpen(false)
    openItem(result.itemId, result.taskId)
  }

  const activeItem = view.kind === 'item' ? items.find((item) => item.id === view.id) : undefined
  const ItemView = activeItem && ITEM_VIEWS[activeItem.type]
  const viewProps: ViewProps | undefined = activeItem && {
    item: activeItem,
    version,
    focusTask,
    onUpdateItem: (patch) => updateItem(activeItem.id, patch),
    onDeleted
  }

  return (
    <div className="app">
      <Sidebar
        items={items}
        activeId={activeItem?.id ?? null}
        activeKind={view.kind}
        renamingId={renamingId}
        onRenaming={setRenamingId}
        onOpen={openItem}
        onCreate={createItem}
        onUpdate={updateItem}
        onReorder={reorderItems}
        onDelete={deleteItem}
        onSearch={() => setSearchOpen(true)}
        onSettings={() => setView({ kind: 'settings' })}
        onTrash={() => setView({ kind: 'trash' })}
      />

      <main className="main">
        {ItemView && viewProps && <ItemView key={viewProps.item.id} {...viewProps} />}
        {view.kind === 'settings' && <SettingsView version={version} />}
        {view.kind === 'trash' && <TrashView version={version} onChanged={onTrashChanged} />}
        {!activeItem && (view.kind === 'item' || view.kind === 'empty') && (
          <div className="empty-state">
            <h1>{items.length === 0 ? 'Welcome to Slateforge' : 'Nothing selected'}</h1>
            <p>Create a board, a list or a note to get started.</p>
            <div className="empty-actions">
              {ITEM_TYPES.map((type) => (
                <button key={type} type="button" className="primary-button" onClick={() => createItem(type)}>
                  New {TYPE_LABEL[type].toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {searchOpen && <SearchDialog items={items} onOpen={openResult} onClose={() => setSearchOpen(false)} />}

      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.canUndo && (
            <button type="button" className="text-button" onClick={undo}>
              <Undo2 size={14} />
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
