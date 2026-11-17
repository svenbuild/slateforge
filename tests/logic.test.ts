import { describe, expect, it } from 'vitest'
import {
  descendantIds,
  makeSnippet,
  moveId,
  placeRow,
  reorderSubset,
  resolveDrop,
  sortTasks,
  todayIso,
  treeRows
} from '../src/shared/logic'
import type { Item, Task } from '../src/shared/types'

function task(id: number, values: Partial<Task> = {}): Task {
  return {
    id,
    itemId: 1,
    columnId: null,
    title: `Task ${id}`,
    description: '',
    priority: 'medium',
    dueDate: null,
    done: false,
    ...values
  }
}

describe('moveId', () => {
  it('moves an id forward and backward', () => {
    expect(moveId([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4])
    expect(moveId([1, 2, 3, 4], 4, 0)).toEqual([4, 1, 2, 3])
  })

  it('inserts an id that was not in the list', () => {
    expect(moveId([1, 2], 9, 1)).toEqual([1, 9, 2])
    expect(moveId([], 9, 0)).toEqual([9])
  })

  it('clamps the index to the list', () => {
    expect(moveId([1, 2, 3], 1, 99)).toEqual([2, 3, 1])
    expect(moveId([1, 2, 3], 3, -5)).toEqual([3, 1, 2])
  })

  it('does not change the input', () => {
    const ids = [1, 2, 3]
    moveId(ids, 3, 0)
    expect(ids).toEqual([1, 2, 3])
  })
})

describe('reorderSubset', () => {
  it('reorders only the given ids and keeps the others in place', () => {
    // 2 and 4 are done tasks, the open tasks 1, 3, 5 get a new order
    expect(reorderSubset([1, 2, 3, 4, 5], [5, 1, 3])).toEqual([5, 2, 1, 4, 3])
  })

  it('returns the same order when nothing moved', () => {
    expect(reorderSubset([1, 2, 3], [1, 3])).toEqual([1, 2, 3])
  })
})

describe('placeRow', () => {
  const tasks = [
    task(1, { columnId: 10 }),
    task(2, { columnId: 20 }),
    task(3, { columnId: 10 }),
    task(4, { columnId: 20 }),
    task(5, { columnId: 10 })
  ]
  const column = (list: Task[], columnId: number): number[] =>
    list.filter((entry) => entry.columnId === columnId).map((entry) => entry.id)
  const placeTask = (list: Task[], id: number, columnId: number, index: number): Task[] =>
    placeRow(list, id, 'columnId', columnId, index)

  it('moves a task down and up inside its column', () => {
    expect(column(placeTask(tasks, 1, 10, 2), 10)).toEqual([3, 5, 1])
    expect(column(placeTask(tasks, 5, 10, 0), 10)).toEqual([5, 1, 3])
    expect(column(placeTask(tasks, 1, 10, 1), 10)).toEqual([3, 1, 5])
  })

  it('moves a task into another column', () => {
    const moved = placeTask(tasks, 1, 20, 1)
    expect(column(moved, 20)).toEqual([2, 1, 4])
    expect(column(moved, 10)).toEqual([3, 5])
  })

  it('moves a task to the end of a column or into an empty one', () => {
    expect(column(placeTask(tasks, 1, 20, 99), 20)).toEqual([2, 4, 1])
    expect(column(placeTask(tasks, 1, 30, 0), 30)).toEqual([1])
  })

  it('ignores unknown tasks', () => {
    expect(placeTask(tasks, 99, 10, 0)).toEqual(tasks)
  })
})

describe('sidebar tree', () => {
  const item = (id: number, parentId: number | null, type: Item['type'] = 'list', collapsed = false): Item => ({
    id,
    parentId,
    type,
    title: `Item ${id}`,
    icon: '',
    color: '',
    sortMode: 'manual',
    collapsed,
    pinned: false
  })
  // 1 folder          4 folder (collapsed)     7 list
  //   2 list            5 list
  //   3 folder
  //     6 list
  const items = [
    item(1, null, 'folder'),
    item(2, 1),
    item(3, 1, 'folder'),
    item(4, null, 'folder', true),
    item(5, 4),
    item(6, 3),
    item(7, null)
  ]

  it('lists the rows from top to bottom and hides collapsed content', () => {
    expect(treeRows(items).map((row) => [row.item.id, row.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [6, 2],
      [4, 0],
      [7, 0]
    ])
  })

  it('finds everything inside a folder', () => {
    expect(descendantIds(items, 1)).toEqual([2, 3, 6])
    expect(descendantIds(items, 7)).toEqual([])
  })

  it('drops before and after an item in the folder of that item', () => {
    expect(resolveDrop(items, 7, 2, 'before')).toEqual({ parentId: 1, index: 0 })
    expect(resolveDrop(items, 7, 2, 'after')).toEqual({ parentId: 1, index: 1 })
    // moving down inside the same folder: the dragged item does not count
    expect(resolveDrop(items, 2, 3, 'after')).toEqual({ parentId: 1, index: 1 })
    expect(resolveDrop(items, 6, 1, 'before')).toEqual({ parentId: null, index: 0 })
  })

  it('drops into a folder at the end, and at the end of the top level', () => {
    const into = resolveDrop(items, 7, 1, 'into')
    expect(into?.parentId).toBe(1)
    const moved = placeRow(items, 7, 'parentId', 1, into?.index ?? 0)
    expect(moved.filter((entry) => entry.parentId === 1).map((entry) => entry.id)).toEqual([2, 3, 7])
    const end = resolveDrop(items, 2, null, 'after')
    const atEnd = placeRow(items, 2, 'parentId', null, end?.index ?? 0)
    expect(atEnd.filter((entry) => entry.parentId === null).map((entry) => entry.id)).toEqual([1, 4, 7, 2])
  })

  it('refuses drops that make no sense', () => {
    expect(resolveDrop(items, 1, 1, 'into')).toBeNull()
    expect(resolveDrop(items, 1, 3, 'into')).toBeNull()
    expect(resolveDrop(items, 1, 6, 'before')).toBeNull()
    expect(resolveDrop(items, 2, 7, 'into')).toBeNull()
    expect(resolveDrop(items, 2, 99, 'before')).toBeNull()
  })
})

describe('sortTasks', () => {
  const tasks = [
    task(1, { priority: 'low', dueDate: '2026-03-01' }),
    task(2, { priority: 'high', dueDate: null }),
    task(3, { priority: 'medium', dueDate: '2026-01-15' }),
    task(4, { priority: 'high', dueDate: '2026-03-01' })
  ]
  const ids = (list: Task[]): number[] => list.map((entry) => entry.id)

  it('keeps the manual order', () => {
    expect(ids(sortTasks(tasks, 'manual'))).toEqual([1, 2, 3, 4])
  })

  it('sorts by due date with undated tasks last', () => {
    expect(ids(sortTasks(tasks, 'due'))).toEqual([3, 1, 4, 2])
  })

  it('sorts by priority from high to low and keeps the manual order for ties', () => {
    expect(ids(sortTasks(tasks, 'priority'))).toEqual([2, 4, 3, 1])
  })
})

describe('makeSnippet', () => {
  it('cuts text around the match and marks cut ends', () => {
    const text = 'aaaaaaaaaa bbbbbbbbbb NEEDLE cccccccccc dddddddddd'
    expect(makeSnippet(text, 'needle', 5)).toEqual({ before: '…bbbb ', match: 'NEEDLE', after: ' cccc…' })
  })

  it('does not add marks when the whole text fits', () => {
    expect(makeSnippet('find me here', 'me')).toEqual({ before: 'find ', match: 'me', after: ' here' })
  })

  it('collapses line breaks', () => {
    expect(makeSnippet('one\n\ntwo   three', 'two')).toEqual({ before: 'one ', match: 'two', after: ' three' })
  })

  it('returns the start of the text without a match', () => {
    expect(makeSnippet('abcdefghij', 'zzz', 2)).toEqual({ before: 'abcd…', match: '', after: '' })
  })
})

describe('todayIso', () => {
  it('formats the local date', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
