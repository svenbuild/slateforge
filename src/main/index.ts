import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { API_METHODS, type Api, type Theme } from '../shared/types'
import { createStore, openDatabase } from './db'

// English texts with day-first dates in the built-in date picker.
app.commandLine.appendSwitch('lang', 'en-GB')

// Tests and the screenshot script use their own data folder.
if (process.env.SLATEFORGE_DATA_DIR) app.setPath('userData', process.env.SLATEFORGE_DATA_DIR)

const dataFile = join(app.getPath('userData'), 'slateforge.db')
let mainWindow: BrowserWindow | null = null

// Window color before the page has loaded, so there is no flash on start.
const WINDOW_COLOR = { light: '#ffffff', dark: '#16171b', black: '#000000' }

// The black theme is a variant of the dark one for the operating system.
function applyTheme(theme: Theme): void {
  nativeTheme.themeSource = theme === 'black' ? 'dark' : theme
}

function createWindow(theme: Theme): void {
  const scheme = theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Slateforge',
    backgroundColor: WINDOW_COLOR[scheme],
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  // The app only ever shows its own page.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function start(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const store = createStore(openDatabase(dataFile))
  const theme = store.getSettings().theme
  applyTheme(theme)

  const api: Api = {
    ...store,
    setTheme(theme) {
      store.setTheme(theme)
      applyTheme(theme)
    },
    getDataPath: () => dataFile,
    showDataFolder: () => shell.showItemInFolder(dataFile)
  }

  // Only the app window may use the API.
  const checkSender = (sender: WebContents): void => {
    if (sender !== mainWindow?.webContents) throw new Error('Unknown sender')
  }
  for (const method of API_METHODS) {
    const handler = api[method] as (...args: unknown[]) => unknown
    ipcMain.handle(`api:${method}`, (event, ...args) => {
      checkSender(event.sender)
      return handler(...args)
    })
  }
  // Used while the window closes, when an async call could get lost.
  ipcMain.on('api:saveNoteSync', (event, itemId, contentJson, contentText) => {
    try {
      checkSender(event.sender)
      store.saveNote(itemId, contentJson, contentText)
    } catch (error) {
      console.error(error)
    }
    event.returnValue = null
  })

  Menu.setApplicationMenu(null)
  createWindow(theme)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.whenReady().then(() => {
    try {
      start()
    } catch (error) {
      dialog.showErrorBox(
        'Slateforge could not start',
        `The data file could not be opened:\n${dataFile}\n\n${error instanceof Error ? error.message : String(error)}`
      )
      app.quit()
    }
  })
}
