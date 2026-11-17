import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseArguments, runCommand } from '../src/main/agent'
import { createStore, openDatabase, type Store } from '../src/main/db'

let store: Store
const run = (...words: string[]): string => runCommand(store, words)

beforeEach(() => {
  store = createStore(openDatabase(':memory:'))
})

describe('parseArguments', () => {
  it('reads numbers, null, lists and text', () => {
    expect(parseArguments(['12', 'null', '[1,2]', 'Buy milk', 'true'])).toEqual([12, null, [1, 2], 'Buy milk', true])
  })

  it('collects key=value words into one object', () => {
    expect(parseArguments(['7', 'done=true', 'title=Call Bob', 'dueDate=null', 'x'])).toEqual([
      7,
      { done: true, title: 'Call Bob', dueDate: null },
      'x'
    ])
  })
})

describe('runCommand', () => {
  it('shows the help without a command', () => {
    expect(run()).toContain('Usage: slateforge')
  })

  it('creates and changes things like the app does', () => {
    const list = JSON.parse(run('createItem', 'list', 'Groceries', 'null'))
    const task = JSON.parse(run('createTask', String(list.id), 'null', 'Milk'))
    expect(run('updateTask', String(task.id), 'done=true', 'priority=high')).toBe('ok')
    expect(store.listTasks(list.id)).toMatchObject([{ title: 'Milk', done: true, priority: 'high' }])
    expect(run('deleteItem', String(list.id), 'false')).toBe('ok')
    expect(store.listItems()).toEqual([])
  })

  it('creates a page from a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slateforge-test-'))
    try {
      const file = join(dir, 'report.html')
      writeFileSync(file, '<h1>Report</h1>')
      const page = JSON.parse(run('createPage', 'Weekly report', 'null', `@${file}`))
      expect(store.getPage(page.id)).toBe('<h1>Report</h1>')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints the tree with ids and open tasks', () => {
    const folder = store.createItem('folder', 'Work', null)
    const list = store.createItem('list', 'Todo', folder.id)
    store.createTask(list.id, null, 'A')
    expect(run('tree')).toBe(`[${folder.id}] folder  Work\n  [${list.id}] list  Todo  (1 open)`)
  })

  it('refuses unknown commands and wrong arguments', () => {
    expect(() => run('explode')).toThrow('Unknown command')
    expect(() => run('toString')).toThrow('Unknown command')
    expect(() => run('createTask', '999', 'null', 'X')).toThrow()
  })
})
