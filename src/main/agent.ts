import { readFileSync } from 'node:fs'
import { treeRows } from '../shared/logic'
import type { Store } from './db'

// Turns command line words into a call of the store. This is the interface
// for AI agents and scripts: every store method is a command.

export const HELP = `Slateforge command line: control the Slateforge app from scripts and AI agents.
The running app shows changes within about a second.

Usage: slateforge <command> [arguments]

Arguments
  numbers, true, false, null      as written
  text                            as written, in quotes if it has spaces
  key=value key=value             become one object, e.g. done=true priority=high
  @path                           the text of that file, e.g. @C:\\tmp\\report.html
                                  (also for text that looks like a number or like key=value)
Output is JSON. An entry is a board, list, note or page. Ids come from "tree".

Look around
  tree                                       all folders and entries with their ids
  listItems                                  the same as JSON
  search <text>                              search titles, tasks, notes and pages
  getBoard <boardId>                         columns and tasks of a board
  listTasks <listId or boardId>              tasks of a list or board
  listDueTasks <YYYY-MM-DD>                  open tasks due until that day
  listProgress                               tasks and done tasks per entry
  getNoteText <noteId>                       text of a note
  getPage <pageId>                           HTML of a page
  getStats                                   counts
  where                                      path of the data file

Pages (HTML, for summaries, overviews, reports and results)
  createPage <title> <folderId|null> <html>  usually with @file for the HTML
  savePage <pageId> <html>                   replace the HTML
  Write only the body: Slateforge adds the house style by itself. Build the
  page from the parts shown in assets\\page-style.html of the Slateforge
  project (h1 with <em>, .chips, .stats, .bars, table, .cols, .note).
  Scripts and files from the internet do not run.

Notes (Markdown)
  createNote <title> <folderId|null> <markdown>
  setNoteMarkdown <noteId> <markdown>        replace the text

Boards, lists, folders
  createItem <board|list|note|page|folder> <title> <folderId|null>
  updateItem <id> title=... icon=... color=... sortMode=manual|due|priority collapsed=true|false pinned=true|false
  setItemOrder <folderId|null> <[ids]>       put these items into the folder in this order
  createColumn <boardId> <title>
  renameColumn <columnId> <title>
  setColumnOrder <boardId> <[columnIds]>

Tasks
  createTask <listId> null <title>           task in a list
  createTask <boardId> <columnId> <title>    task in a board column
  updateTask <taskId> title=... description=... priority=low|medium|high dueDate=YYYY-MM-DD|null done=true|false
  setTaskOrder <listId> null <[taskIds]>     order of a list
  setTaskOrder <boardId> <columnId> <[taskIds]>   order of a column, also moves tasks into it

Delete (goes to the trash, the user can undo it)
  deleteItem <id> <keepContent>              false: a folder goes with its content. true: content moves up
  deleteColumn <columnId>
  deleteTask <taskId>
  listTrash
  restore <item|column|task> <id>
  purge <item|column|task> <id>              deletes forever, only when the user asks for it
  emptyTrash                                 deletes forever, only when the user asks for it`

// "@path" reads a file, JSON becomes its value, everything else stays text.
function parseValue(raw: string): unknown {
  if (raw.startsWith('@')) return readFileSync(raw.slice(1), 'utf8')
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// Neighbouring key=value words are collected into one object.
export function parseArguments(words: string[]): unknown[] {
  const result: unknown[] = []
  let object: Record<string, unknown> | null = null
  for (const word of words) {
    const pair = /^([A-Za-z]\w*)=([\s\S]*)$/.exec(word)
    if (!pair) {
      object = null
      result.push(parseValue(word))
      continue
    }
    if (!object) {
      object = {}
      result.push(object)
    }
    object[pair[1]] = parseValue(pair[2])
  }
  return result
}

function tree(store: Store): string {
  const open = new Map(store.listProgress().map((entry) => [entry.itemId, entry.total - entry.done]))
  const rows = treeRows(store.listItems().map((item) => ({ ...item, collapsed: false })))
  if (rows.length === 0) return '(empty)'
  return rows
    .map(({ item, depth }) => {
      const count = open.get(item.id)
      return `${'  '.repeat(depth)}[${item.id}] ${item.type}  ${item.title}${count ? `  (${count} open)` : ''}`
    })
    .join('\n')
}

// Runs one command and returns the text to print.
export function runCommand(store: Store, words: string[]): string {
  const [command = 'help', ...rest] = words
  if (command === 'help') return HELP
  if (command === 'tree') return tree(store)
  const method = Object.hasOwn(store, command) ? (store as unknown as Record<string, unknown>)[command] : undefined
  if (typeof method !== 'function') throw new Error(`Unknown command "${command}". Run "slateforge help".`)
  const result: unknown = method(...parseArguments(rest))
  return result === undefined ? 'ok' : JSON.stringify(result, null, 2)
}
