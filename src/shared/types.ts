export const ITEM_TYPES = ['board', 'list', 'note'] as const
export const PRIORITIES = ['low', 'medium', 'high'] as const
export const SORT_MODES = ['manual', 'due', 'priority'] as const
export const THEMES = ['system', 'light', 'dark'] as const
export const TRASH_KINDS = ['item', 'column', 'task'] as const

export type ItemType = (typeof ITEM_TYPES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type SortMode = (typeof SORT_MODES)[number]
export type Theme = (typeof THEMES)[number]
export type TrashKind = (typeof TRASH_KINDS)[number]

export interface Item {
  id: number
  type: ItemType
  title: string
  icon: string
  color: string
  sortMode: SortMode
}

export interface Column {
  id: number
  boardId: number
  title: string
}

export interface Task {
  id: number
  itemId: number
  columnId: number | null
  title: string
  description: string
  priority: Priority
  dueDate: string | null
  done: boolean
}

export interface BoardData {
  columns: Column[]
  tasks: Task[]
}

export interface ItemPatch {
  title?: string
  icon?: string
  color?: string
  sortMode?: SortMode
}

export interface TaskPatch {
  title?: string
  description?: string
  priority?: Priority
  dueDate?: string | null
  done?: boolean
}

export interface TrashEntry {
  kind: TrashKind
  id: number
  title: string
  context: string
  deletedAt: string
}

export interface Snippet {
  before: string
  match: string
  after: string
}

export interface SearchResult {
  kind: 'item' | 'task'
  itemId: number
  itemType: ItemType
  itemTitle: string
  taskId: number | null
  title: string
  // Set when the match is in the note text or the task description.
  snippet: Snippet | null
}

export interface Settings {
  theme: Theme
  lastItemId: number | null
}

export interface Stats {
  boards: number
  lists: number
  notes: number
  tasks: number
  openTasks: number
}

// Everything the renderer can ask the main process to do.
export interface Api {
  listItems(): Item[]
  createItem(type: ItemType, title: string): Item
  updateItem(id: number, patch: ItemPatch): void
  setItemOrder(orderedIds: number[]): void
  deleteItem(id: number): void

  getBoard(boardId: number): BoardData
  createColumn(boardId: number, title: string): Column
  renameColumn(id: number, title: string): void
  setColumnOrder(boardId: number, orderedIds: number[]): void
  deleteColumn(id: number): void

  listTasks(itemId: number): Task[]
  createTask(itemId: number, columnId: number | null, title: string): Task
  updateTask(id: number, patch: TaskPatch): void
  setTaskOrder(itemId: number, columnId: number | null, orderedIds: number[]): void
  deleteTask(id: number): void

  getNote(itemId: number): string
  saveNote(itemId: number, contentJson: string, contentText: string): void

  search(query: string): SearchResult[]

  listTrash(): TrashEntry[]
  restore(kind: TrashKind, id: number): void
  purge(kind: TrashKind, id: number): void
  emptyTrash(): void

  getSettings(): Settings
  setTheme(theme: Theme): void
  setLastItem(id: number | null): void
  getStats(): Stats

  getDataPath(): string
  showDataFolder(): void
}

export const API_METHODS = [
  'listItems',
  'createItem',
  'updateItem',
  'setItemOrder',
  'deleteItem',
  'getBoard',
  'createColumn',
  'renameColumn',
  'setColumnOrder',
  'deleteColumn',
  'listTasks',
  'createTask',
  'updateTask',
  'setTaskOrder',
  'deleteTask',
  'getNote',
  'saveNote',
  'search',
  'listTrash',
  'restore',
  'purge',
  'emptyTrash',
  'getSettings',
  'setTheme',
  'setLastItem',
  'getStats',
  'getDataPath',
  'showDataFolder'
] as const satisfies readonly (keyof Api)[]

// The renderer sees every method as async, plus one sync call used while the window closes.
export type RendererApi = {
  [K in keyof Api]: (...args: Parameters<Api[K]>) => Promise<ReturnType<Api[K]>>
} & {
  saveNoteSync(itemId: number, contentJson: string, contentText: string): void
}
