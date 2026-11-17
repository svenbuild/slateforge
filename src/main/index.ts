import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import iconPath from '../../build/icon.ico?asset'
import { API_METHODS, type Api, type Theme } from '../shared/types'
import { createStore, openDatabase } from './db'

// English texts with day-first dates in the built-in date picker.
app.commandLine.appendSwitch('lang', 'en-GB')

// Lets Windows treat the app as its own program in the taskbar.
app.setAppUserModelId('com.slateforge.app')

// Tests and the screenshot script use their own data folder.
if (process.env.SLATEFORGE_DATA_DIR) app.setPath('userData', process.env.SLATEFORGE_DATA_DIR)

const dataFile = join(app.getPath('userData'), 'slateforge.db')
let mainWindow: BrowserWindow | null = null

// Colors that the main process paints itself: the window before the page has
// loaded, and the area of the minimize, maximize and close buttons. The page
// draws the rest of the title bar, so `bar` matches --bg-sidebar in styles.css.
const COLORS = {
  light: { window: '#ffffff', bar: '#f5f5f7', symbols: '#1d1e23' },
  dark: { window: '#16171b', bar: '#1b1c21', symbols: '#e9eaee' },
  black: { window: '#000000', bar: '#000000', symbols: '#ededed' }
}
// One pixel less than .titlebar in styles.css, so the line below the bar stays visible.
const TITLE_BAR_HEIGHT = 37
let theme: Theme = 'system'

function colors(): (typeof COLORS)['dark'] {
  return COLORS[theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme]
}

function titleBarOverlay(): Electron.TitleBarOverlayOptions {
  return { color: colors().bar, symbolColor: colors().symbols, height: TITLE_BAR_HEIGHT }
}

// The black theme is a variant of the dark one for the operating system.
function applyTheme(next: Theme): void {
  theme = next
  nativeTheme.themeSource = next === 'black' ? 'dark' : next
  mainWindow?.setTitleBarOverlay(titleBarOverlay())
}

// Windows switched between light and dark while the app follows the system.
nativeTheme.on('updated', () => mainWindow?.setTitleBarOverlay(titleBarOverlay()))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Slateforge',
    // Icon in the taskbar, also when the app is started from the source code.
    icon: iconPath,
    backgroundColor: colors().window,
    // The page draws its own title bar. Windows only adds the window buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
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
  // Web links in HTML pages open in the normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  // Links inside an HTML page must not load websites into the app either.
  mainWindow.webContents.on('will-frame-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function start(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const db = openDatabase(dataFile)
  const store = createStore(db)

  // The command line tool writes to the same file. This number changes when
  // another program has saved something, and the window then loads again.
  const readVersion = db.prepare('PRAGMA data_version')
  const dataVersion = (): unknown => readVersion.get()?.data_version
  let seenVersion = dataVersion()
  setInterval(() => {
    const version = dataVersion()
    if (version === seenVersion) return
    seenVersion = version
    // The change may have been the theme.
    applyTheme(store.getSettings().theme)
    mainWindow?.webContents.send('external-change')
  }, 1000)
  applyTheme(store.getSettings().theme)

  const api: Api = {
    ...store,
    setTheme(next) {
      store.setTheme(next)
      applyTheme(next)
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
  createWindow()
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
