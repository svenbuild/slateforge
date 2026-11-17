import { describe, expect, it } from 'vitest'
import { makeSnippet, moveId, placeTask, reorderSubset, sortTasks, todayIso } from '../src/shared/logic'
import type { Task } from '../src/shared/types'

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

describe('placeTask', () => {
  const tasks = [
    task(1, { columnId: 10 }),
    task(2, { columnId: 20 }),
    task(3, { columnId: 10 }),
    task(4, { columnId: 20 }),
    task(5, { columnId: 10 })
  ]
  const column = (list: Task[], columnId: number): number[] =>
    list.filter((entry) => entry.columnId === columnId).map((entry) => entry.id)

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
