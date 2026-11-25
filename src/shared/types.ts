// Entries hold content. Folders only group entries and other folders.
// A page is free HTML, mostly written by AI agents for summaries and reports.
// A file is a link to a local file (Markdown, HTML, PDF) that stays where it is.
export const ENTRY_TYPES = ['board', 'list', 'note', 'page', 'file'] as const
export const ITEM_TYPES = [...ENTRY_TYPES, 'folder'] as const
export const PRIORITIES = ['low', 'medium', 'high'] as const
export const SORT_MODES = ['manual', 'due', 'priority'] as const
export const THEMES = ['system', 'light', 'dark', 'black'] as const
export const TRASH_KINDS = ['item', 'column', 'task'] as const

export type EntryType = (typeof ENTRY_TYPES)[number]
export type ItemType = (typeof ITEM_TYPES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type SortMode = (typeof SORT_MODES)[number]
export type Theme = (typeof THEMES)[number]
export type TrashKind = (typeof TRASH_KINDS)[number]

export interface Item {
  id: number
  // The folder this item is in, or null on the top level.
  parentId: number | null
  type: ItemType
  title: string
  icon: string
  color: string
  sortMode: SortMode
  // Only used by folders: hides the content in the sidebar.
  collapsed: boolean
  // Pinned entries are also listed at the top of the sidebar.
  pinned: boolean
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
  collapsed?: boolean
  pinned?: boolean
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
  // True for a folder that still has something inside.
  hasContent: boolean
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

// How many tasks an entry has and how many of them are done.
export interface Progress {
  itemId: number
  total: number
  done: number
}

export type FileKind = 'markdown' | 'html' | 'pdf' | 'other'

// What the app knows about a linked local file.
export interface FileInfo {
  path: string
  name: string
  kind: FileKind
  exists: boolean
  // True for Markdown files that are not on a network drive.
  writable: boolean
  // When the file was last changed, as a number. It grows with every change.
  modified: number
}

export interface Settings {
  theme: Theme
  lastItemId: number | null
}

export interface Stats {
  boards: number
  lists: number
  notes: number
  pages: number
  tasks: number
  openTasks: number
}

// Everything the renderer can ask the main process to do.
export interface Api {
  listItems(): Item[]
  createItem(type: ItemType, title: string, parentId: number | null): Item
  updateItem(id: number, patch: ItemPatch): void
  setItemOrder(parentId: number | null, orderedIds: number[]): void
  // With `keepContent` the content of a folder moves one level up first.
  deleteItem(id: number, keepContent: boolean): void

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
  // Open tasks with a due date up to `untilDate`, oldest first.
  listDueTasks(untilDate: string): Task[]
  listProgress(): Progress[]

  getNote(itemId: number): string
  saveNote(itemId: number, contentJson: string, contentText: string): void
  // Notes as plain text and Markdown, for scripts and AI agents.
  getNoteText(itemId: number): string
  setNoteMarkdown(itemId: number, markdown: string): void
  createNote(title: string, parentId: number | null, markdown: string): Item

  getPage(itemId: number): string
  savePage(itemId: number, html: string): void
  createPage(title: string, parentId: number | null, html: string): Item

  // Links a local file. Its title is the file name.
  createFile(path: string, parentId: number | null): Item
  getFilePath(itemId: number): string
  getFileInfo(itemId: number): Promise<FileInfo>
  readFileText(itemId: number): Promise<string>
  // Only for Markdown files that are not on a network drive. `expected` is
  // the text last read or written: a file that another program changed in
  // the meantime is not overwritten.
  writeFileText(itemId: number, text: string, expected: string): void
  // Lets the user choose files in a dialog. Returns their paths.
  pickFiles(): Promise<string[]>
  // Opens the file in the program that Windows uses for it.
  openFile(itemId: number): Promise<void>
  // Start of the addresses under which pages and files are shown in a frame.
  getViewBase(): string

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
  // Opens the app in the normal browser, on the given entry.
  openInBrowser(itemId: number): void
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
  'listDueTasks',
  'listProgress',
  'getNote',
  'saveNote',
  'getNoteText',
  'setNoteMarkdown',
  'createNote',
  'getPage',
  'savePage',
  'createPage',
  'createFile',
  'getFilePath',
  'getFileInfo',
  'readFileText',
  'writeFileText',
  'pickFiles',
  'openFile',
  'getViewBase',
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
  'showDataFolder',
  'openInBrowser'
] as const satisfies readonly (keyof Api)[]

// The renderer sees every method as async, plus one sync call used while the window closes.
export type RendererApi = {
  [K in keyof Api]: (...args: Parameters<Api[K]>) => Promise<Awaited<ReturnType<Api[K]>>>
} & {
  // Saves that must not get lost while the window or tab is closing.
  saveNoteSync(itemId: number, contentJson: string, contentText: string): void
  writeFileTextSync(itemId: number, text: string, expected: string): void
  // Calls back when another program (the command line tool) changed the
  // data. Returns a function that stops the calls again.
  onExternalChange(callback: () => void): () => void
  // The place on disk of a file that was dragged into the window. Empty in a
  // browser, which does not tell it.
  pathOfFile(file: File): string
}
