import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createStore, MIGRATIONS, openDatabase, type Store } from '../src/main/db'

let store: Store

beforeEach(() => {
  store = createStore(openDatabase(':memory:'))
})

const titles = (rows: { title: string }[]): string[] => rows.map((row) => row.title)

describe('database file', () => {
  it('keeps data after closing and opening again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slateforge-test-'))
    try {
      const file = join(dir, 'test.db')
      const first = openDatabase(file)
      createStore(first).createItem('list', 'Groceries', null)
      first.close()
      const second = openDatabase(file)
      expect(titles(createStore(second).listItems())).toEqual(['Groceries'])
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('migration', () => {
  it('keeps the data of a version 1 database and adds folders', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slateforge-test-'))
    try {
      const file = join(dir, 'old.db')
      const old = new DatabaseSync(file)
      old.exec(MIGRATIONS[0])
      old.exec(`
        INSERT INTO items (id, type, title, position, created_at, updated_at) VALUES (1, 'board', 'Old board', 0, 'x', 'x');
        INSERT INTO items (id, type, title, position, created_at, updated_at) VALUES (2, 'note', 'Old note', 1, 'x', 'x');
        INSERT INTO columns (id, board_id, title, position) VALUES (1, 1, 'To do', 0);
        INSERT INTO tasks (id, item_id, column_id, title, position, created_at, updated_at) VALUES (1, 1, 1, 'Old task', 0, 'x', 'x');
        INSERT INTO notes (item_id, content_json, content_text) VALUES (2, '{"a":1}', 'old text');
        PRAGMA user_version = 1;
      `)
      old.close()

      const db = openDatabase(file)
      const migrated = createStore(db)
      expect(titles(migrated.listItems())).toEqual(['Old board', 'Old note'])
      expect(migrated.listItems()[0]).toMatchObject({ parentId: null, collapsed: false, pinned: false })
      expect(titles(migrated.getBoard(1).tasks)).toEqual(['Old task'])
      expect(migrated.getNote(2)).toBe('{"a":1}')
      // references still work: deleting the board forever removes its task
      const page = migrated.createPage('New page', null, '<p>works</p>')
      expect(migrated.getPage(page.id)).toBe('<p>works</p>')
      const folder = migrated.createItem('folder', 'New folder', null)
      migrated.setItemOrder(folder.id, [1])
      migrated.deleteItem(1, false)
      migrated.purge('item', 1)
      expect(migrated.getStats().tasks).toBe(0)
      expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 })
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('folders', () => {
  it('creates entries inside folders and nested folders', () => {
    const work = store.createItem('folder', 'Work', null)
    const projects = store.createItem('folder', 'Projects', work.id)
    const board = store.createItem('board', 'Website', projects.id)
    store.createItem('note', 'Loose note', null)
    expect(store.listItems().map((item) => [item.title, item.parentId])).toEqual([
      ['Work', null],
      ['Projects', work.id],
      ['Website', projects.id],
      ['Loose note', null]
    ])
    expect(board.parentId).toBe(projects.id)
    expect(() => store.createItem('note', 'X', board.id)).toThrow()
  })

  it('moves items into a folder and back, keeping the given order', () => {
    const folder = store.createItem('folder', 'F', null)
    const a = store.createItem('list', 'A', null)
    const b = store.createItem('list', 'B', null)
    store.setItemOrder(folder.id, [b.id, a.id])
    const inFolder = (): string[] => titles(store.listItems().filter((item) => item.parentId === folder.id))
    expect(inFolder()).toEqual(['B', 'A'])
    store.setItemOrder(null, [a.id, folder.id])
    expect(inFolder()).toEqual(['B'])
    expect(titles(store.listItems().filter((item) => item.parentId === null))).toEqual(['A', 'F'])
  })

  it('refuses to move a folder into itself or into its own content', () => {
    const outer = store.createItem('folder', 'Outer', null)
    const inner = store.createItem('folder', 'Inner', outer.id)
    const list = store.createItem('list', 'L', null)
    expect(() => store.setItemOrder(outer.id, [outer.id])).toThrow()
    expect(() => store.setItemOrder(inner.id, [outer.id])).toThrow()
    expect(() => store.setItemOrder(list.id, [inner.id])).toThrow()
    // something in the trash cannot be moved
    store.deleteItem(list.id, false)
    expect(() => store.setItemOrder(outer.id, [list.id])).toThrow()
    store.restore('item', list.id)
    expect(store.listItems().find((item) => item.id === outer.id)?.parentId).toBeNull()
  })

  it('remembers pinned entries', () => {
    const list = store.createItem('list', 'L', null)
    expect(list.pinned).toBe(false)
    store.updateItem(list.id, { pinned: true })
    expect(store.listItems()[0].pinned).toBe(true)
  })

  it('remembers if a folder is collapsed', () => {
    const folder = store.createItem('folder', 'F', null)
    store.updateItem(folder.id, { collapsed: true })
    expect(store.listItems()[0].collapsed).toBe(true)
  })

  it('deletes a folder with its content and restores both', () => {
    const folder = store.createItem('folder', 'F', null)
    const inner = store.createItem('folder', 'Inner', folder.id)
    const list = store.createItem('list', 'Deep list', inner.id)
    store.createTask(list.id, null, 'Deep task')
    store.deleteItem(folder.id, false)
    expect(store.listItems()).toEqual([])
    expect(store.getStats()).toMatchObject({ lists: 0, tasks: 0 })
    expect(store.search('deep')).toEqual([])
    expect(store.listTrash()).toMatchObject([{ kind: 'item', id: folder.id, context: 'folder', hasContent: true }])
    expect(() => store.createTask(list.id, null, 'X')).toThrow()
    store.restore('item', folder.id)
    expect(titles(store.listItems())).toEqual(['F', 'Inner', 'Deep list'])
    expect(store.getStats()).toMatchObject({ lists: 1, tasks: 1 })
  })

  it('deletes only the folder and moves its content one level up', () => {
    const outer = store.createItem('folder', 'Outer', null)
    const folder = store.createItem('folder', 'F', outer.id)
    store.createItem('list', 'Before', outer.id)
    const a = store.createItem('list', 'A', folder.id)
    const b = store.createItem('note', 'B', folder.id)
    store.setItemOrder(folder.id, [b.id, a.id])
    store.deleteItem(folder.id, true)
    expect(titles(store.listItems().filter((item) => item.parentId === outer.id))).toEqual(['Before', 'B', 'A'])
    expect(store.listTrash()).toMatchObject([{ kind: 'item', id: folder.id }])
    store.emptyTrash()
    expect(titles(store.listItems())).toEqual(['Outer', 'Before', 'B', 'A'])
  })

  it('deletes forever with everything inside the folder', () => {
    const folder = store.createItem('folder', 'F', null)
    const list = store.createItem('list', 'L', folder.id)
    store.createTask(list.id, null, 'T')
    store.deleteItem(folder.id, false)
    store.purge('item', folder.id)
    store.restore('item', list.id)
    expect(store.listItems()).toEqual([])
    expect(store.listTrash()).toEqual([])
  })

  it('leaves folders out of the search and of the last opened entry', () => {
    const folder = store.createItem('folder', 'Findme folder', null)
    store.createItem('list', 'Findme list', folder.id)
    expect(store.search('findme').map((result) => result.title)).toEqual(['Findme list'])
    store.setLastItem(folder.id)
    expect(store.getSettings().lastItemId).toBeNull()
  })
})

describe('overview', () => {
  it('lists open tasks that are due until a date, oldest first', () => {
    const list = store.createItem('list', 'L', null)
    const board = store.createItem('board', 'B', null)
    const [todo] = store.getBoard(board.id).columns
    const late = store.createTask(board.id, todo.id, 'Late')
    const soon = store.createTask(list.id, null, 'Soon')
    const far = store.createTask(list.id, null, 'Far')
    const done = store.createTask(list.id, null, 'Done')
    store.createTask(list.id, null, 'No date')
    store.updateTask(late.id, { dueDate: '2026-11-01' })
    store.updateTask(soon.id, { dueDate: '2026-11-20' })
    store.updateTask(far.id, { dueDate: '2027-01-01' })
    store.updateTask(done.id, { dueDate: '2026-11-02', done: true })
    expect(titles(store.listDueTasks('2026-11-24'))).toEqual(['Late', 'Soon'])
    store.deleteItem(board.id, false)
    expect(titles(store.listDueTasks('2026-11-24'))).toEqual(['Soon'])
    expect(() => store.listDueTasks('soon')).toThrow()
  })

  it('counts all and done tasks per entry', () => {
    const list = store.createItem('list', 'L', null)
    const other = store.createItem('list', 'Other', null)
    store.createItem('list', 'Empty', null)
    const a = store.createTask(list.id, null, 'A')
    store.createTask(list.id, null, 'B')
    const gone = store.createTask(list.id, null, 'C')
    store.createTask(other.id, null, 'D')
    store.updateTask(a.id, { done: true })
    store.deleteTask(gone.id)
    expect(store.listProgress()).toEqual([
      { itemId: list.id, total: 2, done: 1 },
      { itemId: other.id, total: 1, done: 0 }
    ])
  })
})

describe('entries', () => {
  it('creates entries in order and gives boards default columns', () => {
    const board = store.createItem('board', 'Project', null)
    store.createItem('list', 'Groceries', null)
    store.createItem('note', '   ', null)
    expect(titles(store.listItems())).toEqual(['Project', 'Groceries', 'Untitled'])
    expect(titles(store.getBoard(board.id).columns)).toEqual(['To do', 'In progress', 'Done'])
  })

  it('updates title, icon, color and sort mode', () => {
    const list = store.createItem('list', 'Old', null)
    store.updateItem(list.id, { title: 'New', icon: 'star', color: 'red', sortMode: 'due' })
    expect(store.listItems()[0]).toMatchObject({ title: 'New', icon: 'star', color: 'red', sortMode: 'due' })
  })

  it('reorders entries', () => {
    const a = store.createItem('list', 'A', null)
    const b = store.createItem('list', 'B', null)
    const c = store.createItem('list', 'C', null)
    store.setItemOrder(null, [c.id, a.id, b.id])
    expect(titles(store.listItems())).toEqual(['C', 'A', 'B'])
  })

  it('rejects invalid input', () => {
    expect(() => store.createItem('gallery' as never, 'X', null)).toThrow()
    expect(() => store.updateItem(1.5, { title: 'X' })).toThrow()
    expect(() => store.setItemOrder(null, [1, 1])).toThrow()
    expect(() => store.updateItem(1, { sortMode: 'random' as never })).toThrow()
  })
})

describe('tasks', () => {
  it('creates, updates and lists tasks of a list', () => {
    const list = store.createItem('list', 'Groceries', null)
    const milk = store.createTask(list.id, null, 'Milk')
    store.createTask(list.id, null, 'Bread')
    store.updateTask(milk.id, { description: '2 liters', priority: 'high', dueDate: '2026-12-01', done: true })
    const tasks = store.listTasks(list.id)
    expect(titles(tasks)).toEqual(['Milk', 'Bread'])
    expect(tasks[0]).toMatchObject({ description: '2 liters', priority: 'high', dueDate: '2026-12-01', done: true })
    expect(tasks[1]).toMatchObject({ priority: 'medium', dueDate: null, done: false })
  })

  it('reorders tasks inside a list', () => {
    const list = store.createItem('list', 'L', null)
    const a = store.createTask(list.id, null, 'A')
    const b = store.createTask(list.id, null, 'B')
    const c = store.createTask(list.id, null, 'C')
    store.setTaskOrder(list.id, null, [b.id, c.id, a.id])
    expect(titles(store.listTasks(list.id))).toEqual(['B', 'C', 'A'])
  })

  it('moves a task to another column at a given place', () => {
    const board = store.createItem('board', 'B', null)
    const [todo, doing] = store.getBoard(board.id).columns
    const a = store.createTask(board.id, todo.id, 'A')
    const b = store.createTask(board.id, doing.id, 'B')
    const c = store.createTask(board.id, doing.id, 'C')
    store.setTaskOrder(board.id, doing.id, [b.id, a.id, c.id])
    const inDoing = store.getBoard(board.id).tasks.filter((task) => task.columnId === doing.id)
    expect(titles(inDoing)).toEqual(['B', 'A', 'C'])
    expect(store.getBoard(board.id).tasks.filter((task) => task.columnId === todo.id)).toEqual([])
  })

  it('rejects tasks in the wrong container', () => {
    const board = store.createItem('board', 'B', null)
    const other = store.createItem('board', 'Other', null)
    const list = store.createItem('list', 'L', null)
    const note = store.createItem('note', 'N', null)
    const foreignColumn = store.getBoard(other.id).columns[0]
    expect(() => store.createTask(board.id, null, 'X')).toThrow()
    expect(() => store.createTask(board.id, foreignColumn.id, 'X')).toThrow()
    expect(() => store.createTask(list.id, foreignColumn.id, 'X')).toThrow()
    expect(() => store.createTask(note.id, null, 'X')).toThrow()
    expect(() => store.updateTask(1, { dueDate: 'tomorrow' })).toThrow()
    expect(() => store.updateTask(1, { priority: 'urgent' as never })).toThrow()
  })

  it('does not move tasks of another entry', () => {
    const listA = store.createItem('list', 'A', null)
    const listB = store.createItem('list', 'B', null)
    const foreign = store.createTask(listB.id, null, 'Foreign')
    store.setTaskOrder(listA.id, null, [foreign.id])
    expect(titles(store.listTasks(listB.id))).toEqual(['Foreign'])
    expect(store.listTasks(listA.id)).toEqual([])
  })
})

describe('columns', () => {
  it('creates, renames and reorders columns', () => {
    const board = store.createItem('board', 'B', null)
    const extra = store.createColumn(board.id, 'Review')
    store.renameColumn(extra.id, 'In review')
    const ids = store.getBoard(board.id).columns.map((column) => column.id)
    store.setColumnOrder(board.id, [extra.id, ...ids.filter((columnId) => columnId !== extra.id)])
    expect(titles(store.getBoard(board.id).columns)).toEqual(['In review', 'To do', 'In progress', 'Done'])
  })

  it('only allows columns on boards', () => {
    const list = store.createItem('list', 'L', null)
    expect(() => store.createColumn(list.id, 'X')).toThrow()
  })
})

describe('notes', () => {
  it('saves and loads note content', () => {
    const note = store.createItem('note', 'Ideas', null)
    expect(store.getNote(note.id)).toBe('')
    store.saveNote(note.id, '{"type":"doc"}', 'plain text')
    expect(store.getNote(note.id)).toBe('{"type":"doc"}')
  })
})

describe('pages', () => {
  it('saves HTML and finds its text without the tags', () => {
    const page = store.createPage('Weekly report', null, '<style>.x{color:red}</style><h1>Sales</h1><p>Revenue went <b>up</b></p>')
    expect(page).toMatchObject({ type: 'page', title: 'Weekly report' })
    expect(store.getPage(page.id)).toContain('<h1>Sales</h1>')
    expect(store.search('revenue went up')).toMatchObject([{ itemId: page.id, snippet: { match: 'Revenue went up' } }])
    expect(store.search('color')).toEqual([])
    const other = store.createPage('Codes', null, '<p>R&amp;D&nbsp;plan</p>')
    expect(store.search('r&d plan')).toMatchObject([{ itemId: other.id }])
    store.deleteItem(other.id, false)
    store.savePage(page.id, '<p>New text</p>')
    expect(store.getPage(page.id)).toBe('<p>New text</p>')
    expect(store.getStats().pages).toBe(1)
  })

  it('creates nothing when the content is refused', () => {
    expect(() => store.createPage('Bad', null, 5 as never)).toThrow()
    expect(() => store.createNote('Bad', 999, 'text')).toThrow()
    expect(store.listItems()).toEqual([])
  })

  it('only saves HTML into pages', () => {
    const note = store.createItem('note', 'N', null)
    expect(() => store.savePage(note.id, '<p>x</p>')).toThrow()
    expect(() => store.getPage(note.id)).toThrow()
    expect(() => store.getPage(999)).toThrow()
    expect(() => store.getNoteText(999)).toThrow()
    const folder = store.createItem('folder', 'F', null)
    expect(store.createPage('Inside', folder.id, '').parentId).toBe(folder.id)
  })
})

describe('notes from Markdown', () => {
  it('stores Markdown for the editor and plain text for the search', () => {
    const note = store.createNote('Plan', null, '# Goals\n- ship it')
    expect(JSON.parse(store.getNote(note.id))).toEqual({ markdown: '# Goals\n- ship it' })
    expect(store.getNoteText(note.id)).toBe('# Goals\n- ship it')
    expect(store.search('ship')).toHaveLength(1)
    store.setNoteMarkdown(note.id, 'changed')
    expect(store.getNoteText(note.id)).toBe('changed')
    const list = store.createItem('list', 'L', null)
    expect(() => store.setNoteMarkdown(list.id, 'x')).toThrow()
  })
})

describe('trash', () => {
  it('hides a deleted task and restores it in its old place', () => {
    const list = store.createItem('list', 'L', null)
    const a = store.createTask(list.id, null, 'A')
    store.createTask(list.id, null, 'B')
    store.deleteTask(a.id)
    expect(titles(store.listTasks(list.id))).toEqual(['B'])
    expect(store.listTrash()).toMatchObject([{ kind: 'task', id: a.id, title: 'A', context: 'L' }])
    store.restore('task', a.id)
    expect(titles(store.listTasks(list.id))).toEqual(['A', 'B'])
    expect(store.listTrash()).toEqual([])
  })

  it('hides the tasks of a deleted column and brings them back with it', () => {
    const board = store.createItem('board', 'B', null)
    const [todo] = store.getBoard(board.id).columns
    store.createTask(board.id, todo.id, 'A')
    store.deleteColumn(todo.id)
    expect(store.getBoard(board.id).tasks).toEqual([])
    expect(store.getStats().tasks).toBe(0)
    expect(store.listTrash()).toMatchObject([{ kind: 'column', id: todo.id, context: 'B' }])
    store.restore('column', todo.id)
    const data = store.getBoard(board.id)
    expect(titles(data.columns)).toEqual(['To do', 'In progress', 'Done'])
    expect(titles(data.tasks)).toEqual(['A'])
  })

  it('only lists the parent when a child was deleted before it', () => {
    const list = store.createItem('list', 'L', null)
    const task = store.createTask(list.id, null, 'A')
    store.deleteTask(task.id)
    store.deleteItem(list.id, false)
    expect(store.listItems()).toEqual([])
    expect(store.listTrash()).toMatchObject([{ kind: 'item', id: list.id }])
    store.restore('item', list.id)
    expect(store.listTasks(list.id)).toEqual([])
    expect(store.listTrash()).toMatchObject([{ kind: 'task', id: task.id }])
  })

  it('deletes forever with everything inside', () => {
    const board = store.createItem('board', 'B', null)
    const [todo] = store.getBoard(board.id).columns
    store.createTask(board.id, todo.id, 'A')
    const note = store.createItem('note', 'N', null)
    store.deleteItem(board.id, false)
    store.deleteItem(note.id, false)
    store.purge('item', board.id)
    expect(store.listTrash()).toMatchObject([{ kind: 'item', id: note.id }])
    store.emptyTrash()
    expect(store.listTrash()).toEqual([])
    expect(store.getStats()).toEqual({ boards: 0, lists: 0, notes: 0, pages: 0, tasks: 0, openTasks: 0 })
  })

  it('does not delete forever what is not in the trash', () => {
    const list = store.createItem('list', 'L', null)
    store.purge('item', list.id)
    expect(titles(store.listItems())).toEqual(['L'])
  })

  it('ignores a restore of something that is gone', () => {
    const list = store.createItem('list', 'L', null)
    store.deleteItem(list.id, false)
    store.purge('item', list.id)
    expect(() => store.restore('item', list.id)).not.toThrow()
    expect(store.listItems()).toEqual([])
  })
})

describe('search', () => {
  it('finds entries, tasks and note text without caring about case', () => {
    const list = store.createItem('list', 'Garden work', null)
    store.createTask(list.id, null, 'Buy seeds', )
    const task = store.createTask(list.id, null, 'Water plants')
    store.updateTask(task.id, { description: 'Use the garden hose behind the shed' })
    const note = store.createItem('note', 'Ideas', null)
    store.saveNote(note.id, '{}', 'Build a raised GARDEN bed next spring')

    const results = store.search('garden')
    expect(results.map((result) => [result.kind, result.title])).toEqual([
      ['item', 'Garden work'],
      ['item', 'Ideas'],
      ['task', 'Water plants']
    ])
    expect(results[0].snippet).toBeNull()
    expect(results[1].snippet).toMatchObject({ match: 'GARDEN' })
    expect(results[2]).toMatchObject({ taskId: task.id, itemId: list.id, snippet: { match: 'garden' } })
  })

  it('handles umlauts and special characters', () => {
    const list = store.createItem('list', 'ÄRGER mit 100% _Sonderzeichen_', null)
    expect(store.search('ärger')).toHaveLength(1)
    expect(store.search('100%')).toHaveLength(1)
    expect(store.search('_sonder')).toHaveLength(1)
    expect(store.search('%')).toHaveLength(1)
    expect(store.search('x%')).toHaveLength(0)
    expect(store.search('   ')).toEqual([])
    expect(list.id).toBeGreaterThan(0)
  })

  it('skips everything in the trash', () => {
    const board = store.createItem('board', 'Work', null)
    const [todo, doing] = store.getBoard(board.id).columns
    store.createTask(board.id, todo.id, 'Findme one')
    const second = store.createTask(board.id, doing.id, 'Findme two')
    store.deleteTask(second.id)
    expect(store.search('findme')).toHaveLength(1)
    store.deleteColumn(todo.id)
    expect(store.search('findme')).toHaveLength(0)
    store.restore('column', todo.id)
    store.deleteItem(board.id, false)
    expect(store.search('findme')).toHaveLength(0)
    expect(store.search('work')).toHaveLength(0)
  })
})

describe('settings and statistics', () => {
  it('stores the theme and the last opened entry', () => {
    expect(store.getSettings()).toEqual({ theme: 'system', lastItemId: null })
    const list = store.createItem('list', 'L', null)
    store.setTheme('light')
    store.setLastItem(list.id)
    expect(store.getSettings()).toEqual({ theme: 'light', lastItemId: list.id })
    store.deleteItem(list.id, false)
    expect(store.getSettings().lastItemId).toBeNull()
    store.setTheme('black')
    expect(store.getSettings().theme).toBe('black')
    expect(() => store.setTheme('pink' as never)).toThrow()
  })

  it('counts active entries and tasks', () => {
    const board = store.createItem('board', 'B', null)
    const list = store.createItem('list', 'L', null)
    store.createItem('note', 'N', null)
    const [todo] = store.getBoard(board.id).columns
    store.createTask(board.id, todo.id, 'A')
    const done = store.createTask(list.id, null, 'B')
    store.updateTask(done.id, { done: true })
    const gone = store.createTask(list.id, null, 'C')
    store.deleteTask(gone.id)
    expect(store.getStats()).toEqual({ boards: 1, lists: 1, notes: 1, pages: 0, tasks: 2, openTasks: 1 })
  })
})
