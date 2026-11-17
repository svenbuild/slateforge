import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileInfo, fileKind, isNetworkPath, readText, viewFile, writeText } from '../src/main/files'

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
    writeText(file('notes.md'), '# Changed')
    expect(readFileSync(file('notes.md'), 'utf8')).toBe('# Changed')
  })

  it('never writes other kinds of files or files that do not exist', () => {
    expect(() => writeText(file('site', 'index.html'), 'x')).toThrow()
    expect(() => writeText(file('paper.pdf'), 'x')).toThrow()
    expect(() => writeText(file('new.md'), 'x')).toThrow()
    expect(() => writeText('\\\\server\\share\\a.md', 'x')).toThrow()
    expect(readFileSync(file('site', 'index.html'), 'utf8')).toBe('<h1>site</h1>')
  })
})

describe('viewFile', () => {
  it('gives an HTML file and what lies next to it', () => {
    const html = file('site', 'index.html')
    expect(viewFile(html, 'index.html')).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' })
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
    expect(viewFile(file('paper.pdf'), 'other.pdf').status).toBe(404)
    expect(viewFile(file('notes.md'), 'notes.md').status).toBe(404)
  })
})
