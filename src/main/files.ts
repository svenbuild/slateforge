import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve, sep } from 'node:path'
import type { FileInfo, FileKind } from '../shared/types'

// Linked local files: what kind they are, reading, writing and handing them
// to the viewer. Files stay where they are, the app only keeps their path.

const MAX_TEXT_BYTES = 5_000_000

// Types of files that a linked HTML file may load from its own folder.
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf'
}

// What the viewer frame gets for one address.
export interface ViewResult {
  status: number
  type: string
  body: Buffer | string
  // Content security policy for this document, if it needs one.
  policy?: string
}

export const NOT_FOUND: ViewResult = { status: 404, type: 'text/plain', body: 'Not found' }

export function fileKind(path: string): FileKind {
  const extension = extname(path).toLowerCase()
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (extension === '.html' || extension === '.htm') return 'html'
  if (extension === '.pdf') return 'pdf'
  return 'other'
}

// Network drives are strictly read only. A mapped drive letter like Z: is
// found through its real path, which starts with two backslashes.
export function isNetworkPath(path: string, realPath: (path: string) => string = realpathSync.native): boolean {
  if (path.startsWith('\\\\') || path.startsWith('//')) return true
  try {
    return realPath(path).startsWith('\\\\')
  } catch {
    return false
  }
}

export function fileInfo(path: string): FileInfo {
  const kind = fileKind(path)
  const exists = path !== '' && existsSync(path) && statSync(path).isFile()
  return { path, name: basename(path), kind, exists, writable: exists && kind === 'markdown' && !isNetworkPath(path) }
}

export function readText(path: string): string {
  if (statSync(path).size > MAX_TEXT_BYTES) throw new Error('The file is too large to show here.')
  return readFileSync(path, 'utf8')
}

// Only Markdown files that are not on a network drive are ever written.
export function writeText(path: string, text: string): void {
  if (typeof text !== 'string' || text.length > MAX_TEXT_BYTES) throw new Error('Invalid text')
  // The network check comes first: it needs no look at the drive itself.
  if (isNetworkPath(path) || !fileInfo(path).writable) throw new Error('This file cannot be changed from Slateforge.')
  writeFileSync(path, text, 'utf8')
}

// Hands a linked file to the viewer. `relative` is the path the viewer asked
// for, starting at the folder of the linked file. A PDF only gives itself, an
// HTML file also what lies next to it or below (styles, scripts, pictures).
export function viewFile(path: string, relative: string): ViewResult {
  const kind = fileKind(path)
  if (kind !== 'html' && kind !== 'pdf') return NOT_FOUND
  const folder = dirname(resolve(path))
  const wanted = resolve(folder, relative)
  const inside = wanted.startsWith(folder + sep)
  if (!inside || (kind === 'pdf' && wanted !== resolve(path))) return NOT_FOUND
  const type = CONTENT_TYPES[extname(wanted).toLowerCase()]
  if (!type || !existsSync(wanted) || !statSync(wanted).isFile()) return NOT_FOUND
  return { status: 200, type, body: readFileSync(wanted) }
}
