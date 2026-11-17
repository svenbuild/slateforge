import template from '../../../assets/page-style.html?raw'
import type { Column, Task } from '../../shared/types'

// The house style for HTML pages lives in assets/page-style.html, so agents
// and the app use the very same rules.
const PAGE_CSS = /<style>([\s\S]*?)<\/style>/.exec(template)?.[1] ?? ''

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string)
}

// A complete HTML document in the house style. The rule in the head lets it
// use nothing but its own styles and embedded images: no scripts, no files,
// nothing from the internet. Links open in a new window.
export function pageDocument(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><base target="_blank"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body>${body}</body></html>`
}

function taskCard(task: Task): string {
  const facts = [task.priority === 'medium' ? '' : `${task.priority} priority`, task.dueDate ? `due ${task.dueDate}` : '']
    .filter(Boolean)
    .join(', ')
  const details = [facts, task.description].filter(Boolean).map(escapeHtml).join('<br>')
  return `<div class="card${task.done ? ' done' : ''}">${escapeHtml(task.title)}${details ? `<small>${details}</small>` : ''}</div>`
}

export function boardBody(title: string, columns: Column[], tasks: Task[]): string {
  const cols = columns.map(
    (column) =>
      `<div class="col"><b>${escapeHtml(column.title)}</b>${tasks.filter((task) => task.columnId === column.id).map(taskCard).join('')}</div>`
  )
  return `<h1>${escapeHtml(title)}</h1><div class="cols">${cols.join('')}</div>`
}

export function listBody(title: string, open: Task[], done: Task[]): string {
  const column = (name: string, tasks: Task[]): string =>
    tasks.length === 0 ? '' : `<div class="col"><b>${name} (${tasks.length})</b>${tasks.map(taskCard).join('')}</div>`
  return `<h1>${escapeHtml(title)}</h1><div class="cols">${column('Open', open)}${column('Completed', done)}</div>`
}

export function noteBody(title: string, html: string): string {
  return `<h1>${escapeHtml(title)}</h1><div class="prose">${html}</div>`
}
