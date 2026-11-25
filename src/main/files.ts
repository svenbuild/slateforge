import { readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import type { FileInfo, FileKind } from '../shared/types'

// Linked local files: what kind they are, reading, writing and handing them
// to the viewer. Files stay where they are, the app only keeps their path.
// Everything the app does while showing a file runs async, so a slow or lost
// network drive never freezes the window.

const MAX_TEXT_BYTES = 5_000_000
// Marks some UTF-8 files at their very start. It is kept, but not shown.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)
const withoutMark = (text: string): string => (text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text)

// What a linked HTML file may do inside its frame: run scripts and forms and
// open links. It never gets the rights of the app itself. Sent with the file,
// so it also holds when the file is opened in a window of its own.
const FILE_POLICY = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox'

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

// Network drives are strictly read only. A mapped drive letter like Z:, or a
// link that leads to a network share, is found through the real path, which
// then starts with two backslashes. When the real path cannot be found out,
// the file counts as being on the network, to be on the safe side.
export async function isNetworkPath(path: string, realPath: (path: string) => Promise<string> = realpath): Promise<boolean> {
  if (path.startsWith('\\\\') || path.startsWith('//')) return true
  try {
    return (await realPath(path)).startsWith('\\\\')
  } catch {
    return true
  }
}

export async function fileInfo(path: string): Promise<FileInfo> {
  const kind = fileKind(path)
  const stats = path === '' ? null : await stat(path).catch(() => null)
  const exists = stats !== null && stats.isFile()
  return {
    path,
    name: basename(path),
    kind,
    exists,
    writable: exists && kind === 'markdown' && !(await isNetworkPath(path)),
    modified: exists ? stats.mtimeMs : 0
  }
}

// Only UTF-8 is understood: anything else would come out with broken letters
// and must never be written back like that.
function checkSize(size: number): void {
  if (size > MAX_TEXT_BYTES) throw new Error('The file is too large to show here.')
}
function decodeText(data: Buffer): string {
  try {
    // The mark at the start is kept in the text, so it can be written back.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data)
  } catch {
    throw new Error('This file is not saved as UTF-8 text, so it cannot be shown or changed here.')
  }
}

export async function readText(path: string): Promise<string> {
  checkSize((await stat(path)).size)
  return decodeText(await readFile(path))
}

// Saving reads at once, because it must also work while the window closes.
function readTextNow(path: string): string {
  checkSize(statSync(path).size)
  return decodeText(readFileSync(path))
}

// Writes a Markdown file back. `expected` is the text the editor last read
// or wrote. Nothing is written when
// - the file is not a Markdown file on a local drive (checked on the real
//   file, after following links),
// - or it was changed by another program in the meantime.
export function writeText(path: string, text: string, expected: string): void {
  if (typeof text !== 'string' || typeof expected !== 'string') throw new Error('Invalid text')
  // Counted in bytes, like when reading, so a saved file can always be opened again.
  if (Buffer.byteLength(text) + 3 > MAX_TEXT_BYTES) throw new Error('The text is too long to save.')
  if (path.startsWith('\\\\') || path.startsWith('//')) throw new Error('Files on network drives are never changed.')
  // Throws when the file is gone. That also refuses the write.
  const real = realpathSync.native(path)
  if (real.startsWith('\\\\')) throw new Error('Files on network drives are never changed.')
  if (fileKind(path) !== 'markdown' || fileKind(real) !== 'markdown') throw new Error('Only Markdown files can be changed.')
  const current = readTextNow(real)
  if (withoutMark(current) !== expected) {
    throw new Error('The file was changed by another program. Open it again to see the new text.')
  }
  // The new text first goes into a file next to the real one, which then
  // takes its place. If writing fails half way, the old file is untouched.
  const draft = `${real}.slateforge-saving`
  try {
    writeFileSync(draft, (current.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '') + text, 'utf8')
    renameSync(draft, real)
  } catch (error) {
    rmSync(draft, { force: true })
    throw error
  }
}

// The text for the editor: without the invisible mark at the start.
export async function readForEditor(path: string): Promise<string> {
  return withoutMark(await readText(path))
}

// Hands a linked file to the viewer. `wantedPath` is the path the viewer
// asked for, starting at the folder of the linked file. A PDF only gives
// itself, an HTML file also what really lies in its folder or below (styles,
// scripts, pictures). Links that lead out of the folder are not followed.
export async function viewFile(path: string, wantedPath: string): Promise<ViewResult> {
  const kind = fileKind(path)
  if (kind !== 'html' && kind !== 'pdf') return NOT_FOUND
  try {
    const file = await realpath(path)
    const folder = dirname(file)
    const wanted = await realpath(resolve(dirname(resolve(path)), wantedPath))
    const inFolder = relative(folder, wanted)
    const inside = inFolder !== '' && !inFolder.startsWith('..') && !isAbsolute(inFolder)
    if (!inside || (kind === 'pdf' && wanted !== file)) return NOT_FOUND
    const type = CONTENT_TYPES[extname(wanted).toLowerCase()]
    if (!type || !(await stat(wanted)).isFile()) return NOT_FOUND
    // The PDF viewer needs its frame as it is. Everything else is locked in.
    return { status: 200, type, body: await readFile(wanted), ...(type === 'application/pdf' ? {} : { policy: FILE_POLICY }) }
  } catch {
    // The file or the asked part does not exist.
    return NOT_FOUND
  }
}
