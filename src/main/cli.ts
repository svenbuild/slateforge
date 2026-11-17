// Entry point of the command line tool (bin/slateforge.cmd). It works on the
// same data file as the app, whether the app is running or not.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runCommand } from './agent'
import { createStore, openDatabase } from './db'

const dataDir = process.env.SLATEFORGE_DATA_DIR ?? join(process.env.APPDATA ?? '.', 'Slateforge')
const dataFile = join(dataDir, 'slateforge.db')

try {
  const words = process.argv.slice(2)
  if (words[0] === 'where') {
    console.log(dataFile)
  } else {
    mkdirSync(dataDir, { recursive: true })
    const db = openDatabase(dataFile)
    try {
      console.log(runCommand(createStore(db), words))
    } finally {
      db.close()
    }
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
