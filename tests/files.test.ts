import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  it('finds network paths written with two backslashes', async () => {
    expect(await isNetworkPath('\\\\server\\share\\a.md')).toBe(true)
    expect(await isNetworkPath('//server/share/a.md')).toBe(true)
  })

  it('finds mapped drive letters through their real path', async () => {
    expect(await isNetworkPath('Z:\\a.md', async () => '\\\\server\\share\\a.md')).toBe(true)
    expect(await isNetworkPath('C:\\a.md', async () => 'C:\\a.md')).toBe(false)
  })

  it('treats a local file as local', async () => {
    expect(await isNetworkPath(file('notes.md'))).toBe(false)
  })

  it('counts a path that cannot be looked up as network, to be safe', async () => {
    expect(
      await isNetworkPath('C:\\a.md', async () => {
        throw new Error('no such file')
      })
    ).toBe(true)
  })
})

describe('fileInfo', () => {
  it('describes a file and says if it may be changed', async () => {
    expect(await fileInfo(file('notes.md'))).toMatchObject({ name: 'notes.md', kind: 'markdown', exists: true, writable: true })
    expect((await fileInfo(file('notes.md'))).modified).toBeGreaterThan(0)
    expect((await fileInfo(file('missing.md'))).modified).toBe(0)
    expect(await fileInfo(file('paper.pdf'))).toMatchObject({ kind: 'pdf', exists: true, writable: false })
    expect(await fileInfo(file('missing.md'))).toMatchObject({ exists: false, writable: false })
    expect(await fileInfo(dir)).toMatchObject({ exists: false })
    expect(await fileInfo('')).toMatchObject({ exists: false })
  })
})

describe('reading and writing', () => {
  it('reads text and writes Markdown back', async () => {
    expect(await readText(file('notes.md'))).toBe('# Notes')
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

  it('keeps the invisible mark at the start of a file and hides it from the editor', async () => {
    writeFileSync(file('marked.md'), '\uFEFF# Title')
    expect(await readForEditor(file('marked.md'))).toBe('# Title')
    writeText(file('marked.md'), '# New title', '# Title')
    expect(readFileSync(file('marked.md'), 'utf8')).toBe('\uFEFF# New title')
  })

  it('only takes the mark away at the very start', async () => {
    writeFileSync(file('inner.md'), 'a\uFEFFb')
    expect(await readForEditor(file('inner.md'))).toBe('a\uFEFFb')
    writeText(file('inner.md'), 'a\uFEFFb!', 'a\uFEFFb')
    expect(readFileSync(file('inner.md'), 'utf8')).toBe('a\uFEFFb!')
  })

  it('leaves no helper file behind after saving', () => {
    writeFileSync(file('clean.md'), 'one')
    writeText(file('clean.md'), 'two', 'one')
    expect(readFileSync(file('clean.md'), 'utf8')).toBe('two')
    expect(existsSync(file('clean.md.slateforge-saving'))).toBe(false)
  })

  it('refuses text that would be too large to open again', () => {
    writeFileSync(file('big.md'), 'small')
    expect(() => writeText(file('big.md'), 'ä'.repeat(2_600_000), 'small')).toThrow('too long')
    expect(readFileSync(file('big.md'), 'utf8')).toBe('small')
  })

  it('refuses text that is not UTF-8 instead of breaking its letters', async () => {
    // "Größe" saved in the Windows code page, as old editors do
    writeFileSync(file('legacy.md'), Buffer.from([0x47, 0x72, 0xf6, 0xdf, 0x65]))
    await expect(readText(file('legacy.md'))).rejects.toThrow('UTF-8')
    expect(() => writeText(file('legacy.md'), 'x', 'Gr')).toThrow()
    expect(readFileSync(file('legacy.md'))).toEqual(Buffer.from([0x47, 0x72, 0xf6, 0xdf, 0x65]))
  })
})

describe('viewFile', () => {
  it('gives an HTML file and what lies next to it', async () => {
    const html = file('site', 'index.html')
    expect(await viewFile(html, 'index.html')).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' })
    // locked in, also when opened in a window of its own
    expect((await viewFile(html, 'index.html')).policy).toContain('sandbox allow-scripts')
    expect((await viewFile(html, 'index.html')).policy).not.toContain('allow-same-origin')
    expect(await viewFile(html, 'style.css')).toMatchObject({ status: 200, type: 'text/css' })
    expect(await viewFile(html, 'img/logo.png')).toMatchObject({ status: 200, type: 'image/png' })
  })

  it('gives nothing outside the folder and no unknown kinds of files', async () => {
    const html = file('site', 'index.html')
    expect((await viewFile(html, '../notes.md')).status).toBe(404)
    expect((await viewFile(html, '..\\paper.pdf')).status).toBe(404)
    expect((await viewFile(html, 'secret.txt')).status).toBe(404)
    expect((await viewFile(html, 'missing.css')).status).toBe(404)
    expect((await viewFile(html, '')).status).toBe(404)
  })

  it('gives a PDF only itself, and Markdown not at all', async () => {
    expect(await viewFile(file('paper.pdf'), 'paper.pdf')).toMatchObject({ status: 200, type: 'application/pdf' })
    expect((await viewFile(file('paper.pdf'), 'paper.pdf')).policy).toBeUndefined()
    expect((await viewFile(file('paper.pdf'), 'other.pdf')).status).toBe(404)
    expect((await viewFile(file('notes.md'), 'notes.md')).status).toBe(404)
  })
})
