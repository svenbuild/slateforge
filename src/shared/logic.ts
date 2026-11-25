import type { Item, Priority, Snippet, SortMode, Task, UpdateStatus } from './types'

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

// Moves a row into a group at `index` (counted among the other rows of that
// group). `key` names the field that holds the group: the column of a task or
// the folder of a sidebar item. The position of a row in the array is its
// order inside its group.
export function placeRow<T extends { id: number }, K extends keyof T>(
  rows: readonly T[],
  id: number,
  key: K,
  group: T[K],
  index: number
): T[] {
  const row = rows.find((entry) => entry.id === id)
  if (!row) return [...rows]
  const rest = rows.filter((entry) => entry.id !== id)
  const inGroup = rest.filter((entry) => entry[key] === group)
  const before = inGroup[Math.max(0, index)]
  const insertAt = before ? rest.indexOf(before) : rest.length
  rest.splice(insertAt, 0, { ...row, [key]: group })
  return rest
}

// ---- sidebar tree ----

export interface TreeRow {
  item: Item
  depth: number
}

// The sidebar as a flat list from top to bottom. The content of collapsed
// folders is left out.
export function treeRows(items: readonly Item[], parentId: number | null = null, depth = 0): TreeRow[] {
  return items
    .filter((item) => item.parentId === parentId)
    .flatMap((item) => [{ item, depth }, ...(item.collapsed ? [] : treeRows(items, item.id, depth + 1))])
}

// Everything inside a folder, on all levels.
export function descendantIds(items: readonly Item[], id: number): number[] {
  return items
    .filter((item) => item.parentId === id)
    .flatMap((child) => [child.id, ...descendantIds(items, child.id)])
}

export type DropMode = 'before' | 'after' | 'into'

// Where a dragged sidebar item lands: its new folder and its place among the
// other items there. A target of null means the end of the top level. Returns
// null when the drop makes no sense, like a folder dropped into itself.
export function resolveDrop(
  items: readonly Item[],
  draggedId: number,
  targetId: number | null,
  mode: DropMode
): { parentId: number | null; index: number } | null {
  if (targetId === null) return { parentId: null, index: items.length }
  if (targetId === draggedId || descendantIds(items, draggedId).includes(targetId)) return null
  const target = items.find((item) => item.id === targetId)
  if (!target) return null
  if (mode === 'into') return target.type === 'folder' ? { parentId: target.id, index: items.length } : null
  const siblings = items.filter((item) => item.parentId === target.parentId && item.id !== draggedId)
  return { parentId: target.parentId, index: siblings.indexOf(target) + (mode === 'after' ? 1 : 0) }
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

// The line about updates in the settings.
export function updateMessage(status: UpdateStatus): string {
  switch (status.kind) {
    case 'idle':
      return 'Not checked yet.'
    case 'checking':
      return 'Checking for updates…'
    case 'current':
      return 'Slateforge is up to date.'
    case 'downloading':
      return 'Downloading the update…'
    case 'ready':
      return `Version ${status.version} is ready. It installs when Slateforge closes.`
    case 'error':
      return status.message
  }
}
