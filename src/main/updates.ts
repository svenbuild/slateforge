import { NsisUpdater } from 'electron-updater'
import type { UpdateApi, UpdateState, UpdateStatus } from '../shared/types'
import type { Store } from './db'

const FIRST_CHECK_MS = 5_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// Checks GitHub Releases for a newer version and downloads it in the
// background. A downloaded update installs on "Restart now", or when the app
// quits if automatic updates are on. SLATEFORGE_UPDATE_URL points to another folder for testing.
export function createUpdates(
  currentVersion: string,
  store: Pick<Store, 'getSettings' | 'setInstallUpdatesAutomatically'>,
  onChange: (state: UpdateState) => void
): UpdateApi {
  const updater = new NsisUpdater()
  updater.logger = null
  updater.autoDownload = false
  const feedUrl = process.env.SLATEFORGE_UPDATE_URL?.trim()
  if (feedUrl) updater.setFeedURL({ provider: 'generic', url: feedUrl })
  // Errors also reject the promises below. Without a listener, Node would throw.
  updater.on('error', () => {})

  let automatic = store.getSettings().installUpdatesAutomatically
  // With automatic updates off, a downloaded update only installs on "Restart now".
  updater.autoInstallOnAppQuit = automatic
  let status: UpdateStatus = { kind: 'idle' }

  const getState = (): UpdateState => ({ currentVersion, automatic, status })
  const setStatus = (next: UpdateStatus): void => {
    status = next
    onChange(getState())
  }

  async function check(manual: boolean): Promise<void> {
    if (!manual && !automatic) return
    if (status.kind === 'checking' || status.kind === 'downloading' || status.kind === 'ready') return
    setStatus({ kind: 'checking' })
    let failure = 'Could not check for updates.'
    try {
      const result = await updater.checkForUpdates()
      if (!result?.isUpdateAvailable) return setStatus({ kind: 'current' })
      failure = 'Could not download the update.'
      setStatus({ kind: 'downloading' })
      await updater.downloadUpdate()
      setStatus({ kind: 'ready', version: result.updateInfo.version })
    } catch {
      setStatus({ kind: 'error', message: failure })
    }
  }

  setTimeout(() => void check(false), FIRST_CHECK_MS)
  setInterval(() => void check(false), CHECK_INTERVAL_MS)

  return {
    getState,
    check: () => void check(true),
    setAutomatic(enabled) {
      store.setInstallUpdatesAutomatically(enabled)
      automatic = enabled
      updater.autoInstallOnAppQuit = enabled
      onChange(getState())
      if (enabled) void check(false)
    },
    restart() {
      // Not silent: the small progress window of the setup shows that the
      // update is being installed until the app starts again.
      if (status.kind === 'ready') updater.quitAndInstall(false, true)
    }
  }
}
