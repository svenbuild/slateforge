import type { Priority, Snippet, SortMode, Task } from './types'

// Returns a new id list with `id` placed at `toIndex`. Works for moves inside a
// list and for inserting an id that is not in the list yet.
export function moveId(ids: readonly number[], id: number, toIndex: number): number[] {
  const rest = ids.filter((other) => other !== id)
  const index = Math.max(0, Math.min(toIndex, rest.length))
  rest.splice(index, 0, id)
  return rest
}

// Applies a new order to some ids of a list. All other ids keep their place.
// Used by lists: open tasks get reordered while done tasks stay where they are.
export function reorderSubset(allIds: readonly number[], subsetOrder: readonly number[]): number[] {
  const subset = new Set(subsetOrder)
  let next = 0
  return allIds.map((id) => (subset.has(id) ? subsetOrder[next++] : id))
}

// Moves a task into a column at `index` (counted among the other tasks of that
// column). The position of a task in the array is its order inside its column.
export function placeTask(tasks: readonly Task[], taskId: number, columnId: number, index: number): Task[] {
  const task = tasks.find((entry) => entry.id === taskId)
  if (!task) return [...tasks]
  const rest = tasks.filter((entry) => entry.id !== taskId)
  const inColumn = rest.filter((entry) => entry.columnId === columnId)
  const before = inColumn[Math.max(0, index)]
  const insertAt = before ? rest.indexOf(before) : rest.length
  rest.splice(insertAt, 0, { ...task, columnId })
  return rest
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

// Sorts tasks for a list view. The input order is the manual order and is kept
// as tie breaker. Tasks without a due date go last when sorting by due date.
export function sortTasks(tasks: readonly Task[], mode: SortMode): Task[] {
  const sorted = [...tasks]
  if (mode === 'due') {
    sorted.sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    })
  } else if (mode === 'priority') {
    sorted.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
  }
  return sorted
}

// Cuts a short piece of text around the first match of `query` (case-insensitive).
// Without a match the start of the text is returned.
export function makeSnippet(text: string, query: string, radius = 40): Snippet {
  const flat = text.replace(/\s+/g, ' ').trim()
  const needle = query.replace(/\s+/g, ' ').trim()
  const index = needle === '' ? -1 : flat.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) {
    const cut = flat.length > radius * 2
    return { before: cut ? flat.slice(0, radius * 2) + '…' : flat, match: '', after: '' }
  }
  const start = Math.max(0, index - radius)
  const matchEnd = index + needle.length
  const end = Math.min(flat.length, matchEnd + radius)
  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, index),
    match: flat.slice(index, matchEnd),
    after: flat.slice(matchEnd, end) + (end < flat.length ? '…' : '')
  }
}

export function todayIso(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
