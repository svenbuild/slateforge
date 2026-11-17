// Starts the built app with an empty data folder, clicks through all features
// and saves screenshots to ./screenshots. It also works as a smoke test: the
// script stops with an error when something does not behave as expected.
// Run `npm run build` first, then `npm run screenshots`.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const outDir = join(import.meta.dirname, '..', 'screenshots')
const dataDir = mkdtempSync(join(tmpdir(), 'slateforge-shots-'))
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

let app
let page
let counter = 0

async function launch() {
  app = await electron.launch({
    args: [join(import.meta.dirname, '..')],
    env: { ...process.env, SLATEFORGE_DATA_DIR: dataDir },
    // Do not let the test tool force a light design.
    colorScheme: null
  })
  page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') console.log(`[app ${message.type()}]`, message.text())
  })
  page.on('pageerror', (error) => console.log('[app crash]', error.message))
  await page.waitForSelector('.sidebar')
}

async function shot(name) {
  await page.waitForTimeout(250)
  counter += 1
  const file = join(outDir, `${String(counter).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  console.log('saved', file)
}

function check(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`)
  console.log('ok:', message)
}

const texts = (selector) => page.locator(selector).allInnerTexts()

async function drag(from, to, offsetY = 0) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + offsetY, { steps: 12 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  // wait until the drop animation is over
  await page.waitForTimeout(500)
}

async function createEntry(type, title) {
  await page.locator('.sidebar-new button', { hasText: type }).click()
  await page.locator('.sidebar-row input').fill(title)
  await page.keyboard.press('Enter')
}

async function addCard(columnTitle, title) {
  const column = page.locator('.column', { hasText: columnTitle })
  if ((await column.locator('.column-add input').count()) === 0) await column.locator('.column-add-button').click()
  await column.locator('.column-add input').fill(title)
  await page.keyboard.press('Enter')
  await column.locator('.card', { hasText: title }).waitFor()
}

async function setTheme(label) {
  await page.locator('.sidebar-link', { hasText: 'Settings' }).click()
  await page.locator('.theme-choice button', { hasText: label }).click()
  await page.waitForTimeout(500)
}

try {
  await launch()
  await setTheme('Dark')
  await page.locator('.sidebar-brand').click()

  // ---- empty app ----
  check((await texts('.empty-state h1'))[0] === 'Welcome to Slateforge' || (await page.locator('.settings-body').count()) === 1, 'app starts empty')

  // ---- board ----
  await createEntry('Board', 'Website relaunch')
  await addCard('To do', 'Write landing page text')
  await addCard('To do', 'Collect customer quotes')
  await addCard('To do', 'Plan launch newsletter')
  await addCard('In progress', 'Design new logo')
  await addCard('Done', 'Choose color palette')
  await page.keyboard.press('Escape')

  await page.locator('.card', { hasText: 'Write landing page text' }).click()
  await page.locator('.task-panel .segmented button', { hasText: 'High' }).click()
  await page.locator('#task-due').fill('2026-11-20')
  await page.locator('#task-description').fill('Short and friendly. Mention the garden workshop and the new prices.')
  await shot('board-with-task-panel-dark')
  await page.keyboard.press('Escape')
  check((await page.locator('.task-panel').count()) === 0, 'Escape closes the task panel')

  await page.locator('.card', { hasText: 'Choose color palette' }).locator('.check').click()
  await page.locator('.card', { hasText: 'Design new logo' }).click()
  await page.locator('#task-due').fill('2026-11-10')
  await page.locator('.task-panel .segmented button', { hasText: 'Low' }).click()
  await page.keyboard.press('Escape')

  // drag a card to another column
  await drag(page.locator('.card', { hasText: 'Collect customer quotes' }), page.locator('.card', { hasText: 'Design new logo' }))
  check((await texts('.column:nth-of-type(2) .card .task-title')).includes('Collect customer quotes'), 'card dragged into the second column')
  // drag a card inside its column
  await drag(page.locator('.card', { hasText: 'Plan launch newsletter' }), page.locator('.card', { hasText: 'Write landing page text' }), -10)
  check((await texts('.column:nth-of-type(1) .card .task-title'))[0] === 'Plan launch newsletter', 'card reordered inside its column')
  // drag a column
  await drag(page.locator('.column-header', { hasText: 'Done' }), page.locator('.column-header', { hasText: 'To do' }))
  check((await texts('.column-header .inline-text'))[0] === 'Done', 'column dragged to the front')
  await page.locator('.add-column').click()
  await page.locator('.column-header input').fill('Review')
  await page.keyboard.press('Enter')
  await shot('board-dark')

  // ---- list ----
  await createEntry('List', 'Groceries')
  for (const title of ['Milk', 'Bread', 'Apples', 'Coffee beans', 'Garden soil']) {
    await page.locator('.add-task input').fill(title)
    await page.keyboard.press('Enter')
    await page.locator('.task-row', { hasText: title }).waitFor()
  }
  await page.locator('.task-row', { hasText: 'Bread' }).locator('.check').click()
  await page.locator('.task-row', { hasText: 'Coffee beans' }).click()
  await page.locator('.task-panel .segmented button', { hasText: 'High' }).click()
  await page.locator('#task-due').fill('2026-11-18')
  await page.keyboard.press('Escape')
  await page.locator('.task-row', { hasText: 'Apples' }).click()
  await page.locator('#task-due').fill('2026-11-25')
  await page.keyboard.press('Escape')
  await drag(page.locator('.task-row', { hasText: 'Garden soil' }), page.locator('.task-row', { hasText: 'Milk' }), -8)
  check((await texts('.task-list:first-of-type .task-title'))[0] === 'Garden soil', 'list task dragged to the top')
  await shot('list-manual-dark')
  await page.locator('.sort-select select').selectOption('priority')
  check((await texts('.task-list:first-of-type .task-title'))[0] === 'Coffee beans', 'list sorted by priority')
  await page.locator('.sort-select select').selectOption('due')
  check((await texts('.task-list:first-of-type .task-title')).slice(0, 2).join() === 'Coffee beans,Apples', 'list sorted by due date')
  await shot('list-by-due-date-dark')
  await page.locator('.sort-select select').selectOption('manual')

  // ---- note ----
  await createEntry('Note', 'Garden ideas')
  const editor = page.locator('.note-content')
  await editor.click()
  await page.keyboard.type('# Spring plan')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Things to do before **April** starts.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- Build a raised bed')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Order seeds')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[ ] Ask the neighbor for the wheelbarrow')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Buy garden soil')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  check((await editor.locator('h1').innerText()) === 'Spring plan', '"# " makes a heading')
  check((await editor.locator('ul:not([data-type]) li').count()) === 2, '"- " makes a bullet list')
  check((await editor.locator('ul[data-type="taskList"] li').count()) === 2, '"[ ] " makes a checklist')
  check((await editor.locator('strong').innerText()) === 'April', '"**" makes bold text')
  await editor.locator('ul[data-type="taskList"] input').first().click()

  const markdown = '## Pasted from Markdown\n\nSome *italic* and **bold** text with `code`.\n\n1. First step\n2. Second step\n\n- [x] Done item\n- [ ] Open item\n\n> A quote line\n'
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), markdown)
  await page.keyboard.press('Control+V')
  await page.waitForTimeout(500)
  check((await editor.locator('h2').innerText()) === 'Pasted from Markdown', 'pasted Markdown heading is formatted')
  check((await editor.locator('ol li').count()) === 2, 'pasted Markdown numbered list is formatted')
  check((await editor.locator('ul[data-type="taskList"] li').count()) === 4, 'pasted Markdown checklist is formatted')
  check((await editor.locator('blockquote').count()) === 1, 'pasted Markdown quote is formatted')
  await shot('note-dark')

  // ---- search ----
  await page.keyboard.press('Control+K')
  await page.locator('.search-input input').fill('garden')
  await page.locator('.search-results li').first().waitFor()
  await shot('search-dark')
  const found = await texts('.search-results .search-title')
  check(found.length === 3, `search finds the note, the task title and the task description (found ${found.length})`)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await page.locator('.task-panel').waitFor()
  check((await page.locator('.search-dialog').count()) === 0, 'Enter opens the result and closes the search')
  await shot('search-result-opened-dark')
  await page.keyboard.press('Escape')

  // ---- sidebar: icon, color, reorder, rename ----
  await page.locator('.sidebar-row', { hasText: 'Garden ideas' }).hover()
  await page.locator('.sidebar-row', { hasText: 'Garden ideas' }).locator('.row-menu').click()
  await page.locator('.icon-grid button[title="nature"]').click()
  await page.locator('.color-row button[title="green"]').click()
  await shot('sidebar-menu-dark')
  await page.keyboard.press('Escape')
  check((await page.locator('.item-menu').count()) === 0, 'Escape closes the entry menu')
  await page.locator('.sidebar-row', { hasText: 'Groceries' }).hover()
  await page.locator('.sidebar-row', { hasText: 'Groceries' }).locator('.row-menu').click()
  await page.locator('.icon-grid button[title="cart"]').click()
  await page.locator('.color-row button[title="pink"]').click()
  await page.keyboard.press('Escape')
  await drag(page.locator('.sidebar-row', { hasText: 'Garden ideas' }), page.locator('.sidebar-row', { hasText: 'Website relaunch' }), -6)
  check((await texts('.sidebar-row .sidebar-title'))[0] === 'Garden ideas', 'sidebar entry dragged to the top')
  await page.locator('.sidebar-row', { hasText: 'Groceries' }).dblclick()
  await page.locator('.sidebar-row input').fill('Shopping')
  await page.keyboard.press('Enter')
  check((await texts('.sidebar-row .sidebar-title')).includes('Shopping'), 'entry renamed in place')

  // ---- delete, undo, trash ----
  await page.locator('.sidebar-row', { hasText: 'Shopping' }).click()
  await page.locator('.task-row', { hasText: 'Milk' }).click()
  await page.locator('.task-panel button[title="Delete task"]').click()
  await shot('delete-toast-dark')
  check((await page.locator('.task-row', { hasText: 'Milk' }).count()) === 0, 'deleted task is gone')
  await page.locator('.toast .text-button').click()
  await page.locator('.task-row', { hasText: 'Milk' }).waitFor()
  check(true, 'Undo button brings the task back')
  await page.locator('.task-row', { hasText: 'Apples' }).click()
  await page.locator('.task-panel button[title="Delete task"]').click()
  await page.locator('.view-header').click()
  await page.keyboard.press('Control+Z')
  await page.locator('.task-row', { hasText: 'Apples' }).waitFor()
  check(true, 'Ctrl+Z brings the task back')

  await page.locator('.task-row', { hasText: 'Milk' }).click()
  await page.locator('.task-panel button[title="Delete task"]').click()
  await page.locator('.sidebar-row', { hasText: 'Website relaunch' }).click()
  await page.locator('.column', { hasText: 'Review' }).hover()
  await page.locator('.column', { hasText: 'Review' }).locator('.column-delete').click()
  await createEntry('Note', 'Old scratchpad')
  await page.locator('.sidebar-row', { hasText: 'Old scratchpad' }).click({ button: 'right' })
  await page.locator('.menu-row.danger').click()
  await page.locator('.sidebar-link', { hasText: 'Trash' }).click()
  await page.locator('.trash-list li').first().waitFor()
  check((await page.locator('.trash-list li').count()) === 3, 'trash lists the note, the column and the task')
  await shot('trash-dark')
  await page.locator('.trash-list li', { hasText: 'Review' }).locator('button', { hasText: 'Restore' }).click()
  await page.waitForTimeout(200)
  check((await page.locator('.trash-list li').count()) === 2, 'restore removes the entry from the trash')
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.trash-list li', { hasText: 'Old scratchpad' }).locator('button', { hasText: 'Delete forever' }).click()
  await page.waitForTimeout(200)
  check((await page.locator('.trash-list li').count()) === 1, 'delete forever removes the entry')

  // ---- settings and light theme ----
  await page.locator('.sidebar-link', { hasText: 'Settings' }).click()
  await page.locator('.stat').first().waitFor()
  check((await texts('.stat-value')).join() === '1,1,1,9,7', `statistics are correct (${(await texts('.stat-value')).join()})`)
  await shot('settings-dark')

  await setTheme('Light')
  await shot('settings-light')
  await page.locator('.sidebar-row', { hasText: 'Website relaunch' }).click()
  await page.locator('.card', { hasText: 'Write landing page text' }).click()
  await shot('board-with-task-panel-light')
  await page.keyboard.press('Escape')
  await page.locator('.sidebar-row', { hasText: 'Shopping' }).click()
  await shot('list-light')
  await page.locator('.sidebar-row', { hasText: 'Garden ideas' }).click()
  await page.locator('.note-content h1').waitFor()
  await shot('note-light')
  await page.keyboard.press('Control+K')
  await page.locator('.search-input input').fill('step')
  await page.locator('.search-results li').first().waitFor()
  await shot('search-light')
  await page.keyboard.press('Escape')

  // ---- unsaved note text survives closing the window ----
  await page.locator('.note-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('Typed right before closing')
  await app.close()

  // ---- restart: data and last entry are still there ----
  await launch()
  await page.locator('.note-content h1').waitFor()
  check((await texts('.view-header h1'))[0] === 'Garden ideas', 'the last used entry opens after a restart')
  check((await page.locator('.note-content').innerText()).includes('Typed right before closing'), 'text typed right before closing was saved')
  check((await texts('.sidebar-row .sidebar-title')).join() === 'Garden ideas,Website relaunch,Shopping', 'entries and their order survive a restart')
  await page.locator('.sidebar-row', { hasText: 'Website relaunch' }).click()
  await page.locator('.column').first().waitFor()
  check((await texts('.column-header .inline-text')).join() === 'Done,To do,In progress,Review', 'columns and their order survive a restart')
  check((await texts('.column:nth-of-type(2) .card .task-title')).join() === 'Plan launch newsletter,Write landing page text', 'card order survives a restart')
  await shot('after-restart-light')
  await setTheme('System')

  console.log('\nAll checks passed.')
} finally {
  await app?.close().catch(() => {})
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
