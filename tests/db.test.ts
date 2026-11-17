import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createStore, openDatabase, type Store } from '../src/main/db'

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
      createStore(first).createItem('list', 'Groceries')
      first.close()
      const second = openDatabase(file)
      expect(titles(createStore(second).listItems())).toEqual(['Groceries'])
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('entries', () => {
  it('creates entries in order and gives boards default columns', () => {
    const board = store.createItem('board', 'Project')
    store.createItem('list', 'Groceries')
    store.createItem('note', '   ')
    expect(titles(store.listItems())).toEqual(['Project', 'Groceries', 'Untitled'])
    expect(titles(store.getBoard(board.id).columns)).toEqual(['To do', 'In progress', 'Done'])
  })

  it('updates title, icon, color and sort mode', () => {
    const list = store.createItem('list', 'Old')
    store.updateItem(list.id, { title: 'New', icon: 'star', color: 'red', sortMode: 'due' })
    expect(store.listItems()[0]).toMatchObject({ title: 'New', icon: 'star', color: 'red', sortMode: 'due' })
  })

  it('reorders entries', () => {
    const a = store.createItem('list', 'A')
    const b = store.createItem('list', 'B')
    const c = store.createItem('list', 'C')
    store.setItemOrder([c.id, a.id, b.id])
    expect(titles(store.listItems())).toEqual(['C', 'A', 'B'])
  })

  it('rejects invalid input', () => {
    expect(() => store.createItem('folder' as never, 'X')).toThrow()
    expect(() => store.updateItem(1.5, { title: 'X' })).toThrow()
    expect(() => store.setItemOrder([1, 1])).toThrow()
    expect(() => store.updateItem(1, { sortMode: 'random' as never })).toThrow()
  })
})

describe('tasks', () => {
  it('creates, updates and lists tasks of a list', () => {
    const list = store.createItem('list', 'Groceries')
    const milk = store.createTask(list.id, null, 'Milk')
    store.createTask(list.id, null, 'Bread')
    store.updateTask(milk.id, { description: '2 liters', priority: 'high', dueDate: '2026-12-01', done: true })
    const tasks = store.listTasks(list.id)
    expect(titles(tasks)).toEqual(['Milk', 'Bread'])
    expect(tasks[0]).toMatchObject({ description: '2 liters', priority: 'high', dueDate: '2026-12-01', done: true })
    expect(tasks[1]).toMatchObject({ priority: 'medium', dueDate: null, done: false })
  })

  it('reorders tasks inside a list', () => {
    const list = store.createItem('list', 'L')
    const a = store.createTask(list.id, null, 'A')
    const b = store.createTask(list.id, null, 'B')
    const c = store.createTask(list.id, null, 'C')
    store.setTaskOrder(list.id, null, [b.id, c.id, a.id])
    expect(titles(store.listTasks(list.id))).toEqual(['B', 'C', 'A'])
  })

  it('moves a task to another column at a given place', () => {
    const board = store.createItem('board', 'B')
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
    const board = store.createItem('board', 'B')
    const other = store.createItem('board', 'Other')
    const list = store.createItem('list', 'L')
    const note = store.createItem('note', 'N')
    const foreignColumn = store.getBoard(other.id).columns[0]
    expect(() => store.createTask(board.id, null, 'X')).toThrow()
    expect(() => store.createTask(board.id, foreignColumn.id, 'X')).toThrow()
    expect(() => store.createTask(list.id, foreignColumn.id, 'X')).toThrow()
    expect(() => store.createTask(note.id, null, 'X')).toThrow()
    expect(() => store.updateTask(1, { dueDate: 'tomorrow' })).toThrow()
    expect(() => store.updateTask(1, { priority: 'urgent' as never })).toThrow()
  })

  it('does not move tasks of another entry', () => {
    const listA = store.createItem('list', 'A')
    const listB = store.createItem('list', 'B')
    const foreign = store.createTask(listB.id, null, 'Foreign')
    store.setTaskOrder(listA.id, null, [foreign.id])
    expect(titles(store.listTasks(listB.id))).toEqual(['Foreign'])
    expect(store.listTasks(listA.id)).toEqual([])
  })
})

describe('columns', () => {
  it('creates, renames and reorders columns', () => {
    const board = store.createItem('board', 'B')
    const extra = store.createColumn(board.id, 'Review')
    store.renameColumn(extra.id, 'In review')
    const ids = store.getBoard(board.id).columns.map((column) => column.id)
    store.setColumnOrder(board.id, [extra.id, ...ids.filter((columnId) => columnId !== extra.id)])
    expect(titles(store.getBoard(board.id).columns)).toEqual(['In review', 'To do', 'In progress', 'Done'])
  })

  it('only allows columns on boards', () => {
    const list = store.createItem('list', 'L')
    expect(() => store.createColumn(list.id, 'X')).toThrow()
  })
})

describe('notes', () => {
  it('saves and loads note content', () => {
    const note = store.createItem('note', 'Ideas')
    expect(store.getNote(note.id)).toBe('')
    store.saveNote(note.id, '{"type":"doc"}', 'plain text')
    expect(store.getNote(note.id)).toBe('{"type":"doc"}')
  })
})

describe('trash', () => {
  it('hides a deleted task and restores it in its old place', () => {
    const list = store.createItem('list', 'L')
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
    const board = store.createItem('board', 'B')
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
    const list = store.createItem('list', 'L')
    const task = store.createTask(list.id, null, 'A')
    store.deleteTask(task.id)
    store.deleteItem(list.id)
    expect(store.listItems()).toEqual([])
    expect(store.listTrash()).toMatchObject([{ kind: 'item', id: list.id }])
    store.restore('item', list.id)
    expect(store.listTasks(list.id)).toEqual([])
    expect(store.listTrash()).toMatchObject([{ kind: 'task', id: task.id }])
  })

  it('deletes forever with everything inside', () => {
    const board = store.createItem('board', 'B')
    const [todo] = store.getBoard(board.id).columns
    store.createTask(board.id, todo.id, 'A')
    const note = store.createItem('note', 'N')
    store.deleteItem(board.id)
    store.deleteItem(note.id)
    store.purge('item', board.id)
    expect(store.listTrash()).toMatchObject([{ kind: 'item', id: note.id }])
    store.emptyTrash()
    expect(store.listTrash()).toEqual([])
    expect(store.getStats()).toEqual({ boards: 0, lists: 0, notes: 0, tasks: 0, openTasks: 0 })
  })

  it('does not delete forever what is not in the trash', () => {
    const list = store.createItem('list', 'L')
    store.purge('item', list.id)
    expect(titles(store.listItems())).toEqual(['L'])
  })

  it('ignores a restore of something that is gone', () => {
    const list = store.createItem('list', 'L')
    store.deleteItem(list.id)
    store.purge('item', list.id)
    expect(() => store.restore('item', list.id)).not.toThrow()
    expect(store.listItems()).toEqual([])
  })
})

describe('search', () => {
  it('finds entries, tasks and note text without caring about case', () => {
    const list = store.createItem('list', 'Garden work')
    store.createTask(list.id, null, 'Buy seeds', )
    const task = store.createTask(list.id, null, 'Water plants')
    store.updateTask(task.id, { description: 'Use the garden hose behind the shed' })
    const note = store.createItem('note', 'Ideas')
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
    const list = store.createItem('list', 'ÄRGER mit 100% _Sonderzeichen_')
    expect(store.search('ärger')).toHaveLength(1)
    expect(store.search('100%')).toHaveLength(1)
    expect(store.search('_sonder')).toHaveLength(1)
    expect(store.search('%')).toHaveLength(1)
    expect(store.search('x%')).toHaveLength(0)
    expect(store.search('   ')).toEqual([])
    expect(list.id).toBeGreaterThan(0)
  })

  it('skips everything in the trash', () => {
    const board = store.createItem('board', 'Work')
    const [todo, doing] = store.getBoard(board.id).columns
    store.createTask(board.id, todo.id, 'Findme one')
    const second = store.createTask(board.id, doing.id, 'Findme two')
    store.deleteTask(second.id)
    expect(store.search('findme')).toHaveLength(1)
    store.deleteColumn(todo.id)
    expect(store.search('findme')).toHaveLength(0)
    store.restore('column', todo.id)
    store.deleteItem(board.id)
    expect(store.search('findme')).toHaveLength(0)
    expect(store.search('work')).toHaveLength(0)
  })
})

describe('settings and statistics', () => {
  it('stores the theme and the last opened entry', () => {
    expect(store.getSettings()).toEqual({ theme: 'system', lastItemId: null })
    const list = store.createItem('list', 'L')
    store.setTheme('light')
    store.setLastItem(list.id)
    expect(store.getSettings()).toEqual({ theme: 'light', lastItemId: list.id })
    store.deleteItem(list.id)
    expect(store.getSettings().lastItemId).toBeNull()
    expect(() => store.setTheme('pink' as never)).toThrow()
  })

  it('counts active entries and tasks', () => {
    const board = store.createItem('board', 'B')
    const list = store.createItem('list', 'L')
    store.createItem('note', 'N')
    const [todo] = store.getBoard(board.id).columns
    store.createTask(board.id, todo.id, 'A')
    const done = store.createTask(list.id, null, 'B')
    store.updateTask(done.id, { done: true })
    const gone = store.createTask(list.id, null, 'C')
    store.deleteTask(gone.id)
    expect(store.getStats()).toEqual({ boards: 1, lists: 1, notes: 1, tasks: 2, openTasks: 1 })
  })
})
