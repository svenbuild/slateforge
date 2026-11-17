// Turns assets/icon.svg into build/icon.ico (the icon of Slateforge.exe).
// Only needed again when the SVG changes: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZES = [16, 24, 32, 48, 64, 256]

app.whenReady().then(async () => {
  const svg = readFileSync(join(__dirname, '..', 'assets', 'icon.svg'), 'utf8')
  const window = new BrowserWindow({
    show: false,
    width: 256,
    height: 256,
    useContentSize: true,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const html = `<body style="margin:0;background:transparent"><div style="width:256px;height:256px">${svg}</div></body>`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await window.webContents.capturePage()
  const images = SIZES.map((size) => image.resize({ width: size, height: size, quality: 'best' }).toPNG())

  // An .ico file is a small directory followed by the images (PNG is allowed).
  const header = Buffer.alloc(6 + 16 * SIZES.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(SIZES.length, 4)
  let offset = header.length
  SIZES.forEach((size, index) => {
    const entry = 6 + 16 * index
    header.writeUInt8(size === 256 ? 0 : size, entry)
    header.writeUInt8(size === 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[index].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[index].length
  })

  const outDir = join(__dirname, '..', 'build')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, ...images]))
  writeFileSync(join(outDir, 'icon.png'), images[images.length - 1])
  console.log('wrote build/icon.ico and build/icon.png')
  app.quit()
})
