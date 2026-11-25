import { FolderOpen, Monitor, Moon, MoonStar, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { updateMessage } from '../../shared/logic'
import type { Stats, Theme, UpdateState } from '../../shared/types'
import { api } from './api'
import { applyTheme } from './ui'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'black', label: 'Black', icon: MoonStar }
] as const

export function SettingsView({ version, updateState }: { version: number; updateState: UpdateState | null }) {
  const [theme, setTheme] = useState<Theme>('system')
  const [stats, setStats] = useState<Stats | null>(null)
  const [dataPath, setDataPath] = useState('')
  const updates = api.updates

  useEffect(() => {
    api.getSettings().then((settings) => setTheme(settings.theme))
    api.getDataPath().then(setDataPath)
  }, [])

  useEffect(() => {
    api.getStats().then(setStats)
  }, [version])

  const chooseTheme = (value: Theme): void => {
    setTheme(value)
    applyTheme(value)
    api.setTheme(value)
  }

  const numbers = stats
    ? [
        ['Boards', stats.boards],
        ['Lists', stats.lists],
        ['Notes', stats.notes],
        ['Pages', stats.pages],
        ['Tasks', stats.tasks],
        ['Open tasks', stats.openTasks]
      ]
    : []

  return (
    <div className="view">
      <header className="view-header">
        <h1>Settings</h1>
      </header>
      <div className="view-body settings-body">
        <section>
          <h2>Appearance</h2>
          <div className="segmented theme-choice">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={theme === option.value ? 'active' : ''}
                onClick={() => chooseTheme(option.value)}
              >
                <option.icon size={15} />
                {option.label}
              </button>
            ))}
          </div>
          <p className="hint">System follows the light or dark setting of Windows.</p>
        </section>

        <section>
          <h2>Statistics</h2>
          <div className="stats">
            {numbers.map(([label, value]) => (
              <div key={label} className="stat">
                <span className="stat-value">{value}</span>
                <span className="stat-label">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {updateState && updates && (
          <section>
            <h2>Updates</h2>
            <p className="hint">Current version {updateState.currentVersion}</p>
            <p className="hint" role="status">{updateMessage(updateState.status)}</p>
            <div className="update-controls">
              <button
                type="button"
                className="ghost-button"
                onClick={() => updates.check()}
                disabled={updateState.status.kind === 'checking' || updateState.status.kind === 'downloading' || updateState.status.kind === 'ready'}
              >
                Check for updates
              </button>
              {updateState.status.kind === 'ready' && (
                <button type="button" className="ghost-button" onClick={() => updates.restart()}>
                  Restart now
                </button>
              )}
            </div>
            <label className="update-toggle">
              <input
                type="checkbox"
                checked={updateState.automatic}
                onChange={(event) => updates.setAutomatic(event.target.checked)}
              />
              Install updates automatically
            </label>
          </section>
        )}

        <section>
          <h2>Data</h2>
          <p className="hint">Everything is stored only on this computer, in this file:</p>
          <div className="data-path">
            <code>{dataPath}</code>
            <button type="button" className="ghost-button" onClick={() => api.showDataFolder()}>
              <FolderOpen size={15} />
              Show in folder
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
