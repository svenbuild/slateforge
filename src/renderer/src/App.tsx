import { Search, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { placeRow } from '../../shared/logic'
import type { Item, ItemPatch, ItemType, Progress, SearchResult } from '../../shared/types'
import iconUrl from '../../../assets/icon.svg'
import { api } from './api'
import { BoardView } from './BoardView'
import { ListView } from './ListView'
import { NoteView } from './NoteView'
import { OverviewView } from './OverviewView'
import { SearchDialog } from './SearchDialog'
import { SettingsView } from './SettingsView'
import { Sidebar } from './Sidebar'
import { TrashView } from './TrashView'
import { ChoiceDialog, applyTheme, isEditable, type Deleted, type ViewProps } from './ui'

type View = { kind: 'item'; id: number } | { kind: 'overview' } | { kind: 'settings' } | { kind: 'trash' }

interface Toast {
  text: string
  canUndo: boolean
}

const TOAST_MS = 6000
const ITEM_VIEWS = { board: BoardView, list: ListView, note: NoteView, folder: null }

export function App() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [progress, setProgress] = useState<Progress[]>([])
  const [view, setView] = useState<View>({ kind: 'overview' })
  const [focusTask, setFocusTask] = useState<{ taskId: number } | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [folderToDelete, setFolderToDelete] = useState<Item | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  // Counts up when trashed data comes back, so the open view loads again.
  const [version, setVersion] = useState(0)
  // Deletes of this session, newest last. Undo restores the newest one.
  const undoStack = useRef<Deleted[]>([])
  // The newest items for callbacks that are created only once.
  const itemsRef = useRef<Item[]>([])
  itemsRef.current = items ?? []

  const updateItem = useCallback((id: number, patch: ItemPatch) => {
    setItems((current) => (current ?? []).map((item) => (item.id === id ? { ...item, ...patch } : item)))
    api.updateItem(id, patch)
  }, [])

  // Opens an entry and unfolds the folders around it so it shows in the sidebar.
  const openItem = useCallback(
    (id: number, taskId: number | null = null, list: Item[] = itemsRef.current) => {
      setView({ kind: 'item', id })
      setFocusTask(taskId === null ? null : { taskId })
      api.setLastItem(id)
      let folder = list.find((item) => item.id === list.find((entry) => entry.id === id)?.parentId)
      while (folder) {
        if (folder.collapsed) updateItem(folder.id, { collapsed: false })
        const parentId = folder.parentId
        folder = list.find((item) => item.id === parentId)
      }
    },
    [updateItem]
  )

  // The open task counts next to the entries and on the overview.
  const refreshProgress = useCallback(() => {
    api.listProgress().then(setProgress)
  }, [])

  useEffect(() => {
    Promise.all([api.listItems(), api.getSettings()]).then(([loaded, settings]) => {
      applyTheme(settings.theme)
      setItems(loaded)
      if (settings.lastItemId !== null) openItem(settings.lastItemId, null, loaded)
    })
  }, [openItem])

  useEffect(refreshProgress, [refreshProgress, version])

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
    const loaded = await api.listItems()
    setItems(loaded)
    setVersion((current) => current + 1)
    const restored = loaded.find((item) => last.kind === 'item' && item.id === last.id)
    if (restored && restored.type !== 'folder') openItem(restored.id, null, loaded)
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

  const createItem = async (type: ItemType, parentId: number | null = null): Promise<void> => {
    const item = await api.createItem(type, `New ${type}`, parentId)
    setItems((current) => [...(current ?? []), item])
    if (type === 'folder') {
      // A new folder inside a collapsed folder would be invisible.
      const parent = items.find((other) => other.id === parentId)
      if (parent?.collapsed) updateItem(parent.id, { collapsed: false })
    } else {
      openItem(item.id, null, [...items, item])
    }
    setRenamingId(item.id)
  }

  // Puts an item into a folder (or the top level) at a place among the items there.
  const moveItem = (id: number, parentId: number | null, index: number): void => {
    const moved = placeRow(items, id, 'parentId', parentId, index)
    setItems(moved)
    const parent = items.find((item) => item.id === parentId)
    if (parent?.collapsed) updateItem(parent.id, { collapsed: false })
    api.setItemOrder(
      parentId,
      moved.filter((item) => item.parentId === parentId).map((item) => item.id)
    )
  }

  // With `keepContent` only the folder goes and its content moves one level up.
  const removeItem = async (item: Item, keepContent: boolean): Promise<void> => {
    setFolderToDelete(null)
    await api.deleteItem(item.id, keepContent)
    const loaded = await api.listItems()
    setItems(loaded)
    // The open entry may have been deleted, alone or together with its folder.
    setView((current) =>
      current.kind === 'item' && !loaded.some((other) => other.id === current.id) ? { kind: 'overview' } : current
    )
    onDeleted({ kind: 'item', id: item.id, title: item.title })
    // Task counts and the overview must forget the tasks that went with it.
    setVersion((current) => current + 1)
  }

  // A folder with content asks first what should happen to the content.
  const deleteItem = (item: Item): void => {
    if (item.type === 'folder' && items.some((other) => other.parentId === item.id)) setFolderToDelete(item)
    else removeItem(item, false)
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
    onDeleted,
    onTasksChanged: refreshProgress
  }
  // An entry that no longer exists falls back to the overview.
  const showOverview = view.kind === 'overview' || (view.kind === 'item' && !ItemView)

  return (
    <div className="app">
      {/* Own title bar. The empty parts can be used to move the window. */}
      <header className="titlebar">
        <img src={iconUrl} alt="" />
        <span className="titlebar-name">Slateforge</span>
        <button type="button" className="search-button" onClick={() => setSearchOpen(true)}>
          <Search size={14} />
          Search
          <kbd>Ctrl K</kbd>
        </button>
      </header>

      <div className="app-body">
      <Sidebar
        items={items}
        progress={progress}
        activeId={activeItem?.id ?? null}
        activeKind={showOverview ? 'overview' : view.kind}
        renamingId={renamingId}
        onRenaming={setRenamingId}
        onOpen={openItem}
        onCreate={createItem}
        onUpdate={updateItem}
        onMove={moveItem}
        onDelete={deleteItem}
        onOverview={() => setView({ kind: 'overview' })}
        onSettings={() => setView({ kind: 'settings' })}
        onTrash={() => setView({ kind: 'trash' })}
      />

      <main className="main">
        {ItemView && viewProps && <ItemView key={viewProps.item.id} {...viewProps} />}
        {showOverview && (
          <OverviewView
            items={items}
            progress={progress}
            version={version}
            onOpen={openItem}
            onCreate={createItem}
            onTasksChanged={refreshProgress}
          />
        )}
        {view.kind === 'settings' && <SettingsView version={version} />}
        {view.kind === 'trash' && <TrashView version={version} onChanged={onTrashChanged} />}
      </main>
      </div>

      {searchOpen && <SearchDialog items={items} onOpen={openResult} onClose={() => setSearchOpen(false)} />}

      {folderToDelete && (
        <ChoiceDialog
          title={`Delete folder "${folderToDelete.title}"?`}
          text="The folder is not empty. You can keep what is inside (it moves one level up) or move everything to the trash together with the folder."
          choices={[
            { label: 'Keep content', onChoose: () => removeItem(folderToDelete, true) },
            { label: 'Delete content too', danger: true, onChoose: () => removeItem(folderToDelete, false) }
          ]}
          onCancel={() => setFolderToDelete(null)}
        />
      )}

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
