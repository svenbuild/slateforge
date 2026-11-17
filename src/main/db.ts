import { DatabaseSync } from 'node:sqlite'
import { makeSnippet } from '../shared/logic'
import {
  ITEM_TYPES,
  PRIORITIES,
  SORT_MODES,
  THEMES,
  TRASH_KINDS,
  type Api,
  type Column,
  type Item,
  type ItemType,
  type SearchResult,
  type Task,
  type Theme,
  type TrashEntry,
  type TrashKind
} from '../shared/types'

// The part of the API that only needs the database.
export type Store = Omit<Api, 'getDataPath' | 'showDataFolder'>

type Row = Record<string, unknown>

const MAX_TITLE = 500
const MAX_TEXT = 100_000
const MAX_NOTE = 20_000_000
// Per kind of result (entries and tasks), so one kind cannot crowd out the other.
const SEARCH_LIMIT = 25

export const MIGRATIONS = [
  `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('board', 'list', 'note')),
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    sort_mode TEXT NOT NULL DEFAULT 'manual' CHECK (sort_mode IN ('manual', 'due', 'priority')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE columns (
    id INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    column_id INTEGER REFERENCES columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    due_date TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE notes (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    content_json TEXT NOT NULL DEFAULT '',
    content_text TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX idx_columns_board ON columns(board_id);
  CREATE INDEX idx_tasks_item ON tasks(item_id);
  CREATE INDEX idx_tasks_column ON tasks(column_id);
  `,
  // Version 2: folders. The type check of a table cannot be changed in place,
  // so the items table is built again (foreign keys are off during migrations).
  `
  CREATE TABLE items_new (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('board', 'list', 'note', 'folder')),
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    sort_mode TEXT NOT NULL DEFAULT 'manual' CHECK (sort_mode IN ('manual', 'due', 'priority')),
    collapsed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  INSERT INTO items_new (id, type, title, icon, color, position, sort_mode, created_at, updated_at, deleted_at)
    SELECT id, type, title, icon, color, position, sort_mode, created_at, updated_at, deleted_at FROM items;
  DROP TABLE items;
  ALTER TABLE items_new RENAME TO items;
  CREATE INDEX idx_items_parent ON items(parent_id);
  -- Items that are not in the trash and not inside a trashed folder.
  CREATE VIEW live_items AS
    WITH RECURSIVE live(id) AS (
      SELECT id FROM items WHERE parent_id IS NULL AND deleted_at IS NULL
      UNION ALL
      SELECT i.id FROM items i JOIN live ON i.parent_id = live.id WHERE i.deleted_at IS NULL
    )
    SELECT items.* FROM items JOIN live ON live.id = items.id;
  `,
  // Version 3: HTML pages. The items table is built once more, this time
  // without a list of allowed types, so new types need no rebuild again.
  `
  DROP VIEW live_items;
  CREATE TABLE items_new (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    sort_mode TEXT NOT NULL DEFAULT 'manual' CHECK (sort_mode IN ('manual', 'due', 'priority')),
    collapsed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  INSERT INTO items_new (id, parent_id, type, title, icon, color, position, sort_mode, collapsed, created_at, updated_at, deleted_at)
    SELECT id, parent_id, type, title, icon, color, position, sort_mode, collapsed, created_at, updated_at, deleted_at FROM items;
  DROP TABLE items;
  ALTER TABLE items_new RENAME TO items;
  CREATE INDEX idx_items_parent ON items(parent_id);
  CREATE VIEW live_items AS
    WITH RECURSIVE live(id) AS (
      SELECT id FROM items WHERE parent_id IS NULL AND deleted_at IS NULL
      UNION ALL
      SELECT i.id FROM items i JOIN live ON i.parent_id = live.id WHERE i.deleted_at IS NULL
    )
    SELECT items.* FROM items JOIN live ON live.id = items.id;
  CREATE TABLE pages (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    html TEXT NOT NULL DEFAULT '',
    content_text TEXT NOT NULL DEFAULT ''
  );
  `
]

// A task counts as active when the task, its entry and its column are not in the trash.
const ACTIVE_TASKS = `
  FROM tasks t
  JOIN live_items i ON i.id = t.item_id
  LEFT JOIN columns c ON c.id = t.column_id
  WHERE t.deleted_at IS NULL
    AND (t.column_id IS NULL OR c.deleted_at IS NULL)`

const TABLES: Record<TrashKind, string> = { item: 'items', column: 'columns', task: 'tasks' }

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  // Foreign keys stay off while tables are rebuilt by a migration.
  // The app and the command line tool may use the file at the same time, so
  // a write waits a moment when the other one is writing.
  db.exec('PRAGMA busy_timeout = 4000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;')
  // SQLite only lowercases ASCII, so search uses the JavaScript version.
  db.function('ulower', { deterministic: true }, (value) =>
    typeof value === 'string' ? value.toLowerCase() : value
  )
  migrate(db)
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}

function transaction(db: DatabaseSync, work: () => void): void {
  db.exec('BEGIN')
  try {
    work()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function migrate(db: DatabaseSync): void {
  const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version)
  if (version > MIGRATIONS.length) {
    throw new Error('This database was created by a newer version of Slateforge.')
  }
  for (let next = version; next < MIGRATIONS.length; next++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[next])
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('Migration broke a reference.')
      db.exec(`PRAGMA user_version = ${next + 1}`)
    })
  }
}

// ---- input checks (the renderer is not trusted blindly) ----

function id(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error('Invalid id')
  return value as number
}

function idOrNull(value: unknown): number | null {
  return value === null ? null : id(value)
}

function idList(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 100_000) throw new Error('Invalid id list')
  const ids = value.map(id)
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate ids')
  return ids
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text')
  return value
}

function title(value: unknown): string {
  return text(value, MAX_TITLE).trim() || 'Untitled'
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new Error('Invalid value')
  return value as T
}

function dateOrNull(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date')
  return value
}

// ---- row mapping ----

function toItem(row: Row): Item {
  return {
    id: row.id as number,
    parentId: row.parent_id as number | null,
    type: row.type as ItemType,
    title: row.title as string,
    icon: row.icon as string,
    color: row.color as string,
    sortMode: row.sort_mode as Item['sortMode'],
    collapsed: row.collapsed === 1
  }
}

function toColumn(row: Row): Column {
  return { id: row.id as number, boardId: row.board_id as number, title: row.title as string }
}

function toTask(row: Row): Task {
  return {
    id: row.id as number,
    itemId: row.item_id as number,
    columnId: row.column_id as number | null,
    title: row.title as string,
    description: row.description as string,
    priority: row.priority as Task['priority'],
    dueDate: row.due_date as string | null,
    done: row.done === 1
  }
}

export function createStore(db: DatabaseSync): Store {
  const now = (): string => new Date().toISOString()
  const all = (sql: string, ...params: (string | number | null)[]): Row[] =>
    db.prepare(sql).all(...params) as Row[]
  const get = (sql: string, ...params: (string | number | null)[]): Row | undefined =>
    db.prepare(sql).get(...params) as Row | undefined
  const run = (sql: string, ...params: (string | number | null)[]): number =>
    Number(db.prepare(sql).run(...params).lastInsertRowid)
  const count = (sql: string, ...params: (string | number | null)[]): number =>
    Number(get(sql, ...params)?.n ?? 0)

  function nextPosition(table: string, where: string, ...params: (string | number | null)[]): number {
    return count(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ${table} WHERE ${where}`, ...params)
  }

  function activeItem(itemId: number): Item {
    const row = get('SELECT * FROM live_items WHERE id = ?', itemId)
    if (!row) throw new Error('Entry not found')
    return toItem(row)
  }

  // A parent is either the top level (null) or a folder.
  function checkParent(parentId: number | null): void {
    if (parentId !== null && activeItem(parentId).type !== 'folder') throw new Error('Not a folder')
  }

  // Checks that a task container is valid: boards need one of their columns, lists need none.
  function checkContainer(itemId: number, columnId: number | null): void {
    const item = activeItem(itemId)
    if (item.type === 'list' && columnId === null) return
    if (item.type === 'board' && columnId !== null) {
      const column = get(
        'SELECT id FROM columns WHERE id = ? AND board_id = ? AND deleted_at IS NULL',
        columnId,
        itemId
      )
      if (column) return
    }
    throw new Error('Invalid task container')
  }

  function setSetting(key: string, value: string | null): void {
    if (value === null) run('DELETE FROM settings WHERE key = ?', key)
    else run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value)
  }

  // Writes the given columns of one row.
  function updateRow(table: string, rowId: number, changes: [string, string | number | null][]): void {
    const assignments = changes.map(([column]) => `${column} = ?`).join(', ')
    run(`UPDATE ${table} SET ${assignments} WHERE id = ?`, ...changes.map(([, value]) => value), rowId)
  }

  function listTasks(itemId: number): Task[] {
    return all(`SELECT t.* ${ACTIVE_TASKS} AND t.item_id = ? ORDER BY t.position, t.id`, id(itemId)).map(toTask)
  }

  const store: Store = {
    listItems() {
      return all('SELECT * FROM live_items ORDER BY position, id').map(toItem)
    },

    createItem(type, rawTitle, parentId) {
      oneOf(type, ITEM_TYPES)
      checkParent(idOrNull(parentId))
      const name = title(rawTitle)
      let itemId = 0
      transaction(db, () => {
        itemId = run(
          'INSERT INTO items (parent_id, type, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          parentId,
          type,
          name,
          nextPosition('items', 'parent_id IS ?', parentId),
          now(),
          now()
        )
        if (type === 'note') run('INSERT INTO notes (item_id) VALUES (?)', itemId)
        if (type === 'page') run('INSERT INTO pages (item_id) VALUES (?)', itemId)
        if (type === 'board') {
          ;['To do', 'In progress', 'Done'].forEach((columnTitle, position) =>
            run('INSERT INTO columns (board_id, title, position) VALUES (?, ?, ?)', itemId, columnTitle, position)
          )
        }
      })
      return activeItem(itemId)
    },

    updateItem(itemId, patch) {
      id(itemId)
      const changes: [string, string | number][] = []
      if (patch.title !== undefined) changes.push(['title', title(patch.title)])
      if (patch.icon !== undefined) changes.push(['icon', text(patch.icon, 50)])
      if (patch.color !== undefined) changes.push(['color', text(patch.color, 50)])
      if (patch.sortMode !== undefined) changes.push(['sort_mode', oneOf(patch.sortMode, SORT_MODES)])
      if (patch.collapsed !== undefined) changes.push(['collapsed', patch.collapsed === true ? 1 : 0])
      changes.push(['updated_at', now()])
      updateRow('items', itemId, changes)
    },

    // Writes the complete order of one folder (or of the top level). Items
    // dragged in from somewhere else are moved by this as well.
    setItemOrder(parentId, orderedIds) {
      checkParent(idOrNull(parentId))
      const ids = idList(orderedIds)
      // Trashed items stay where they are.
      ids.forEach(activeItem)
      // A folder must not end up inside itself.
      for (let up = parentId; up !== null; up = get('SELECT parent_id FROM items WHERE id = ?', up)?.parent_id as number | null) {
        if (ids.includes(up)) throw new Error('A folder cannot be moved into itself')
      }
      transaction(db, () => {
        ids.forEach((itemId, position) =>
          run('UPDATE items SET position = ?, parent_id = ? WHERE id = ?', position, parentId, itemId)
        )
      })
    },

    deleteItem(itemId, keepContent) {
      const row = get('SELECT parent_id FROM items WHERE id = ? AND deleted_at IS NULL', id(itemId))
      if (!row) return
      const parentId = row.parent_id as number | null
      transaction(db, () => {
        if (keepContent === true) {
          // The content goes to the end of the level above, in its old order.
          const offset = nextPosition('items', 'parent_id IS ?', parentId)
          run('UPDATE items SET parent_id = ?, position = position + ? WHERE parent_id = ?', parentId, offset, itemId)
        }
        run('UPDATE items SET deleted_at = ? WHERE id = ?', now(), itemId)
      })
    },

    getBoard(boardId) {
      id(boardId)
      const columns = all(
        'SELECT * FROM columns WHERE board_id = ? AND deleted_at IS NULL ORDER BY position, id',
        boardId
      ).map(toColumn)
      return { columns, tasks: listTasks(boardId) }
    },

    createColumn(boardId, rawTitle) {
      if (activeItem(id(boardId)).type !== 'board') throw new Error('Not a board')
      const columnId = run(
        'INSERT INTO columns (board_id, title, position) VALUES (?, ?, ?)',
        boardId,
        title(rawTitle),
        nextPosition('columns', 'board_id = ?', boardId)
      )
      return toColumn(get('SELECT * FROM columns WHERE id = ?', columnId) as Row)
    },

    renameColumn(columnId, rawTitle) {
      run('UPDATE columns SET title = ? WHERE id = ?', title(rawTitle), id(columnId))
    },

    setColumnOrder(boardId, orderedIds) {
      id(boardId)
      const ids = idList(orderedIds)
      transaction(db, () => {
        ids.forEach((columnId, position) =>
          run('UPDATE columns SET position = ? WHERE id = ? AND board_id = ?', position, columnId, boardId)
        )
      })
    },

    deleteColumn(columnId) {
      run('UPDATE columns SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', now(), id(columnId))
    },

    listTasks,

    createTask(itemId, columnId, rawTitle) {
      checkContainer(id(itemId), idOrNull(columnId))
      const taskId = run(
        'INSERT INTO tasks (item_id, column_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        itemId,
        columnId,
        title(rawTitle),
        nextPosition('tasks', 'item_id = ?', itemId),
        now(),
        now()
      )
      return toTask(get('SELECT * FROM tasks WHERE id = ?', taskId) as Row)
    },

    updateTask(taskId, patch) {
      id(taskId)
      const changes: [string, string | number | null][] = []
      if (patch.title !== undefined) changes.push(['title', title(patch.title)])
      if (patch.description !== undefined) changes.push(['description', text(patch.description, MAX_TEXT)])
      if (patch.priority !== undefined) changes.push(['priority', oneOf(patch.priority, PRIORITIES)])
      if (patch.dueDate !== undefined) changes.push(['due_date', dateOrNull(patch.dueDate)])
      if (patch.done !== undefined) changes.push(['done', patch.done === true ? 1 : 0])
      changes.push(['updated_at', now()])
      updateRow('tasks', taskId, changes)
    },

    // Writes the complete order of one container. Tasks dragged in from another
    // column are moved by this as well.
    setTaskOrder(itemId, columnId, orderedIds) {
      checkContainer(id(itemId), idOrNull(columnId))
      const ids = idList(orderedIds)
      transaction(db, () => {
        ids.forEach((taskId, position) =>
          run(
            'UPDATE tasks SET position = ?, column_id = ? WHERE id = ? AND item_id = ?',
            position,
            columnId,
            taskId,
            itemId
          )
        )
      })
    },

    deleteTask(taskId) {
      run('UPDATE tasks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', now(), id(taskId))
    },

    listDueTasks(untilDate) {
      return all(
        `SELECT t.* ${ACTIVE_TASKS} AND t.done = 0 AND t.due_date <= ? ORDER BY t.due_date, t.id`,
        dateOrNull(untilDate)
      ).map(toTask)
    },

    listProgress() {
      return all(`SELECT t.item_id, COUNT(*) AS total, SUM(t.done) AS done ${ACTIVE_TASKS} GROUP BY t.item_id`).map(
        (row) => ({ itemId: row.item_id as number, total: Number(row.total), done: Number(row.done) })
      )
    },

    getNote(itemId) {
      const row = get('SELECT content_json FROM notes WHERE item_id = ?', id(itemId))
      return (row?.content_json as string | undefined) ?? ''
    },

    saveNote(itemId, contentJson, contentText) {
      id(itemId)
      text(contentJson, MAX_NOTE)
      text(contentText, MAX_NOTE)
      transaction(db, () => {
        run('UPDATE notes SET content_json = ?, content_text = ? WHERE item_id = ?', contentJson, contentText, itemId)
        run('UPDATE items SET updated_at = ? WHERE id = ?', now(), itemId)
      })
    },

    getNoteText(itemId) {
      const row = get('SELECT content_text FROM notes WHERE item_id = ?', id(itemId))
      return (row?.content_text as string | undefined) ?? ''
    },

    // The editor turns the Markdown into formatted text when the note is opened.
    setNoteMarkdown(itemId, markdown) {
      if (activeItem(id(itemId)).type !== 'note') throw new Error('Not a note')
      store.saveNote(itemId, JSON.stringify({ markdown: text(markdown, MAX_NOTE) }), markdown)
    },

    createNote(rawTitle, parentId, markdown) {
      text(markdown, MAX_NOTE)
      const item = store.createItem('note', rawTitle, parentId)
      store.setNoteMarkdown(item.id, markdown)
      return item
    },

    getPage(itemId) {
      const row = get('SELECT html FROM pages WHERE item_id = ?', id(itemId))
      return (row?.html as string | undefined) ?? ''
    },

    savePage(itemId, html) {
      if (activeItem(id(itemId)).type !== 'page') throw new Error('Not a page')
      // The text without tags is what the search looks through.
      const plain = text(html, MAX_NOTE)
        .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      transaction(db, () => {
        run('UPDATE pages SET html = ?, content_text = ? WHERE item_id = ?', html, plain, itemId)
        run('UPDATE items SET updated_at = ? WHERE id = ?', now(), itemId)
      })
    },

    createPage(rawTitle, parentId, html) {
      text(html, MAX_NOTE)
      const item = store.createItem('page', rawTitle, parentId)
      store.savePage(item.id, html)
      return item
    },

    search(rawQuery) {
      const query = text(rawQuery, MAX_TITLE).trim()
      if (query === '') return []
      const needle = query.toLowerCase()
      const results: SearchResult[] = []

      const items = all(
        `SELECT i.id, i.type, i.title, COALESCE(n.content_text, p.content_text, '') AS body
         FROM live_items i LEFT JOIN notes n ON n.item_id = i.id LEFT JOIN pages p ON p.item_id = i.id
         WHERE i.type <> 'folder'
           AND (instr(ulower(i.title), ?) > 0 OR instr(ulower(COALESCE(n.content_text, p.content_text, '')), ?) > 0)
         ORDER BY instr(ulower(i.title), ?) = 0, i.position, i.id
         LIMIT ?`,
        needle,
        needle,
        needle,
        SEARCH_LIMIT
      )
      for (const row of items) {
        const body = row.body as string
        results.push({
          kind: 'item',
          itemId: row.id as number,
          itemType: row.type as ItemType,
          itemTitle: row.title as string,
          taskId: null,
          title: row.title as string,
          snippet: body.toLowerCase().includes(needle) ? makeSnippet(body, query) : null
        })
      }

      const tasks = all(
        `SELECT t.id, t.title, t.description, i.id AS item_id, i.type, i.title AS item_title
         ${ACTIVE_TASKS}
           AND (instr(ulower(t.title), ?) > 0 OR instr(ulower(t.description), ?) > 0)
         ORDER BY instr(ulower(t.title), ?) = 0, t.updated_at DESC
         LIMIT ?`,
        needle,
        needle,
        needle,
        SEARCH_LIMIT
      )
      for (const row of tasks) {
        const description = row.description as string
        results.push({
          kind: 'task',
          itemId: row.item_id as number,
          itemType: row.type as ItemType,
          itemTitle: row.item_title as string,
          taskId: row.id as number,
          title: row.title as string,
          snippet: description.toLowerCase().includes(needle) ? makeSnippet(description, query) : null
        })
      }
      return results
    },

    // The trash only shows things whose parents still exist. Things below a
    // trashed parent come back together with that parent.
    listTrash() {
      const rows = all(
        `SELECT 'item' AS kind, id, title, type AS context, deleted_at,
           EXISTS (SELECT 1 FROM items child WHERE child.parent_id = items.id) AS has_content
         FROM items
         WHERE deleted_at IS NOT NULL AND (parent_id IS NULL OR parent_id IN (SELECT id FROM live_items))
         UNION ALL
         SELECT 'column', c.id, c.title, i.title, c.deleted_at, 0
         FROM columns c JOIN live_items i ON i.id = c.board_id
         WHERE c.deleted_at IS NOT NULL
         UNION ALL
         SELECT 'task', t.id, t.title, i.title, t.deleted_at, 0
         FROM tasks t JOIN live_items i ON i.id = t.item_id LEFT JOIN columns c ON c.id = t.column_id
         WHERE t.deleted_at IS NOT NULL
           AND (t.column_id IS NULL OR c.deleted_at IS NULL)
         ORDER BY deleted_at DESC`
      )
      return rows.map(
        (row): TrashEntry => ({
          kind: row.kind as TrashKind,
          id: row.id as number,
          title: row.title as string,
          context: row.context as string,
          deletedAt: row.deleted_at as string,
          hasContent: row.has_content === 1
        })
      )
    },

    // Puts a trashed row back where it was. Does nothing if the row is gone.
    restore(kind, rowId) {
      oneOf(kind, TRASH_KINDS)
      run(`UPDATE ${TABLES[kind]} SET deleted_at = NULL WHERE id = ?`, id(rowId))
    },

    purge(kind, rowId) {
      oneOf(kind, TRASH_KINDS)
      run(`DELETE FROM ${TABLES[kind]} WHERE id = ? AND deleted_at IS NOT NULL`, id(rowId))
    },

    emptyTrash() {
      transaction(db, () => {
        for (const table of Object.values(TABLES)) db.exec(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL`)
      })
    },

    getSettings() {
      const values = new Map(all('SELECT key, value FROM settings').map((row) => [row.key, row.value]))
      const theme = THEMES.includes(values.get('theme') as Theme) ? (values.get('theme') as Theme) : 'system'
      const lastId = Number(values.get('lastItemId'))
      const lastItem = get("SELECT id FROM live_items WHERE id = ? AND type <> 'folder'", lastId || 0)
      return { theme, lastItemId: lastItem ? lastId : null }
    },

    setTheme(theme) {
      setSetting('theme', oneOf(theme, THEMES))
    },

    setLastItem(itemId) {
      const value = idOrNull(itemId)
      setSetting('lastItemId', value === null ? null : String(value))
    },

    getStats() {
      const byType = (type: ItemType): number =>
        count('SELECT COUNT(*) AS n FROM live_items WHERE type = ?', type)
      return {
        boards: byType('board'),
        lists: byType('list'),
        notes: byType('note'),
        pages: byType('page'),
        tasks: count(`SELECT COUNT(*) AS n ${ACTIVE_TASKS}`),
        openTasks: count(`SELECT COUNT(*) AS n ${ACTIVE_TASKS} AND t.done = 0`)
      }
    }
  }
  return store
}
