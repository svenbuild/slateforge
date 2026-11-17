import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileInfo, fileKind, isNetworkPath, readForEditor, readText, viewFile, writeText } from '../src/main/files'

let dir: string
const file = (...parts: string[]): string => join(dir, ...parts)

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'slateforge-files-'))
  mkdirSync(file('site', 'img'), { recursive: true })
  writeFileSync(file('site', 'index.html'), '<h1>site</h1>')
  writeFileSync(file('site', 'style.css'), 'body{}')
  writeFileSync(file('site', 'img', 'logo.png'), 'png')
  writeFileSync(file('site', 'secret.txt'), 'not for the viewer')
  writeFileSync(file('notes.md'), '# Notes')
  writeFileSync(file('paper.pdf'), '%PDF-1.4')
  writeFileSync(file('other.pdf'), '%PDF-1.4 other')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('fileKind', () => {
  it('knows Markdown, HTML and PDF by the ending of the name', () => {
    expect(fileKind('a.md')).toBe('markdown')
    expect(fileKind('A.MARKDOWN')).toBe('markdown')
    expect(fileKind('a.HTM')).toBe('html')
    expect(fileKind('a.pdf')).toBe('pdf')
    expect(fileKind('a.docx')).toBe('other')
  })
})

describe('isNetworkPath', () => {
  it('finds network paths written with two backslashes', () => {
    expect(isNetworkPath('\\\\server\\share\\a.md')).toBe(true)
    expect(isNetworkPath('//server/share/a.md')).toBe(true)
  })

  it('finds mapped drive letters through their real path', () => {
    expect(isNetworkPath('Z:\\a.md', () => '\\\\server\\share\\a.md')).toBe(true)
    expect(isNetworkPath('C:\\a.md', () => 'C:\\a.md')).toBe(false)
  })

  it('treats a local file as local', () => {
    expect(isNetworkPath(file('notes.md'))).toBe(false)
  })

  it('counts a path that cannot be looked up as network, to be safe', () => {
    expect(
      isNetworkPath('C:\\a.md', () => {
        throw new Error('no such file')
      })
    ).toBe(true)
  })
})

describe('fileInfo', () => {
  it('describes a file and says if it may be changed', () => {
    expect(fileInfo(file('notes.md'))).toMatchObject({ name: 'notes.md', kind: 'markdown', exists: true, writable: true })
    expect(fileInfo(file('paper.pdf'))).toMatchObject({ kind: 'pdf', exists: true, writable: false })
    expect(fileInfo(file('missing.md'))).toMatchObject({ exists: false, writable: false })
    expect(fileInfo(dir)).toMatchObject({ exists: false })
    expect(fileInfo('')).toMatchObject({ exists: false })
  })
})

describe('reading and writing', () => {
  it('reads text and writes Markdown back', () => {
    expect(readText(file('notes.md'))).toBe('# Notes')
    writeText(file('notes.md'), '# Changed', '# Notes')
    expect(readFileSync(file('notes.md'), 'utf8')).toBe('# Changed')
  })

  it('does not overwrite a file that another program changed', () => {
    writeFileSync(file('shared.md'), 'version from the other program')
    expect(() => writeText(file('shared.md'), 'my version', 'what I read earlier')).toThrow('changed by another program')
    expect(readFileSync(file('shared.md'), 'utf8')).toBe('version from the other program')
  })

  it('never writes other kinds of files or files that do not exist', () => {
    expect(() => writeText(file('site', 'index.html'), 'x', '<h1>site</h1>')).toThrow()
    expect(() => writeText(file('paper.pdf'), 'x', '%PDF-1.4')).toThrow()
    expect(() => writeText(file('new.md'), 'x', '')).toThrow()
    expect(() => writeText('\\\\server\\share\\a.md', 'x', '')).toThrow('network')
    expect(readFileSync(file('site', 'index.html'), 'utf8')).toBe('<h1>site</h1>')
  })

  it('keeps the invisible mark at the start of a file and hides it from the editor', () => {
    writeFileSync(file('marked.md'), '\uFEFF# Title')
    expect(readForEditor(file('marked.md'))).toBe('# Title')
    writeText(file('marked.md'), '# New title', '# Title')
    expect(readFileSync(file('marked.md'), 'utf8')).toBe('\uFEFF# New title')
  })

  it('refuses text that is not UTF-8 instead of breaking its letters', () => {
    // "Größe" saved in the Windows code page, as old editors do
    writeFileSync(file('legacy.md'), Buffer.from([0x47, 0x72, 0xf6, 0xdf, 0x65]))
    expect(() => readText(file('legacy.md'))).toThrow('UTF-8')
    expect(() => writeText(file('legacy.md'), 'x', 'Gr')).toThrow()
    expect(readFileSync(file('legacy.md'))).toEqual(Buffer.from([0x47, 0x72, 0xf6, 0xdf, 0x65]))
  })
})

describe('viewFile', () => {
  it('gives an HTML file and what lies next to it', () => {
    const html = file('site', 'index.html')
    expect(viewFile(html, 'index.html')).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' })
    // locked in, also when opened in a window of its own
    expect(viewFile(html, 'index.html').policy).toContain('sandbox allow-scripts')
    expect(viewFile(html, 'index.html').policy).not.toContain('allow-same-origin')
    expect(viewFile(html, 'style.css')).toMatchObject({ status: 200, type: 'text/css' })
    expect(viewFile(html, 'img/logo.png')).toMatchObject({ status: 200, type: 'image/png' })
  })

  it('gives nothing outside the folder and no unknown kinds of files', () => {
    const html = file('site', 'index.html')
    expect(viewFile(html, '../notes.md').status).toBe(404)
    expect(viewFile(html, '..\\paper.pdf').status).toBe(404)
    expect(viewFile(html, 'secret.txt').status).toBe(404)
    expect(viewFile(html, 'missing.css').status).toBe(404)
    expect(viewFile(html, '').status).toBe(404)
  })

  it('gives a PDF only itself, and Markdown not at all', () => {
    expect(viewFile(file('paper.pdf'), 'paper.pdf')).toMatchObject({ status: 200, type: 'application/pdf' })
    expect(viewFile(file('paper.pdf'), 'paper.pdf').policy).toBeUndefined()
    expect(viewFile(file('paper.pdf'), 'other.pdf').status).toBe(404)
    expect(viewFile(file('notes.md'), 'notes.md').status).toBe(404)
  })
})
