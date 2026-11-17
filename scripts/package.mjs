// Builds dist/Slateforge-win32-x64 with Slateforge.exe inside.
// Run through `npm run package`, which builds the app first.
import { packager } from '@electron/packager'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

// The built app in ./out contains everything it needs, so only that folder
// and package.json go into the package (no node_modules, no sources).
const keep = (path) => path === '' || path === '/package.json' || path === '/out' || path.startsWith('/out/')

const [folder] = await packager({
  dir: root,
  out: join(root, 'dist'),
  name: 'Slateforge',
  platform: 'win32',
  arch: 'x64',
  icon: join(root, 'build', 'icon.ico'),
  asar: true,
  overwrite: true,
  prune: false,
  ignore: (path) => !keep(path)
})
console.log('Packaged app:', folder)
