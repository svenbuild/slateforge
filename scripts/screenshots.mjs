// Starts the built app with an empty data folder, clicks through all features
// and saves screenshots to ./screenshots. It also works as a smoke test: the
// script stops with an error when something does not behave as expected.
// Run `npm run build` first, then `npm run screenshots`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    // Set SLATEFORGE_EXE to test a packaged Slateforge.exe instead of the build in ./out.
    ...(process.env.SLATEFORGE_EXE ? { executablePath: process.env.SLATEFORGE_EXE, args: [] } : { args: [join(import.meta.dirname, '..')] }),
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

// Runs the command line tool for AI agents on the data folder of this test.
function cli(...words) {
  return execFileSync(process.execPath, [join(import.meta.dirname, '..', 'out', 'main', 'cli.js'), ...words], {
    env: { ...process.env, SLATEFORGE_DATA_DIR: dataDir },
    encoding: 'utf8'
  })
}

// A sidebar row by its exact title.
const row = (title) => page.locator('.sidebar-row').filter({ has: page.getByText(title, { exact: true }) })

// A date some days from today as YYYY-MM-DD.
function day(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

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
  await page.locator('.sidebar-new > button').click()
  await page.locator('.new-menu button', { hasText: type }).click()
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
  await page.locator('#task-due').fill(day(3))
  await page.locator('#task-description').fill('Short and friendly. Mention the garden workshop and the new prices.')
  await shot('board-with-task-panel-dark')
  await page.keyboard.press('Escape')
  check((await page.locator('.task-panel').count()) === 0, 'Escape closes the task panel')

  await page.locator('.card', { hasText: 'Choose color palette' }).locator('.check').click()
  await page.locator('.card', { hasText: 'Design new logo' }).click()
  await page.locator('#task-due').fill(day(-7))
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
  await page.locator('#task-due').fill(day(1))
  await page.keyboard.press('Escape')
  await page.locator('.task-row', { hasText: 'Apples' }).click()
  await page.locator('#task-due').fill(day(8))
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

  // text typed right before switching to another entry is saved
  await page.keyboard.press('Control+End')
  await page.keyboard.type('Typed right before switching')
  await page.locator('.sidebar-row', { hasText: 'Groceries' }).click()
  await page.locator('.task-row').first().waitFor()
  await page.locator('.sidebar-row', { hasText: 'Garden ideas' }).click()
  await page.locator('.note-content h1').waitFor()
  check((await page.locator('.note-content').innerText()).includes('Typed right before switching'), 'text typed right before switching entries was saved')

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
  check((await texts('.stat-value')).join() === '1,1,1,0,9,7', `statistics are correct (${(await texts('.stat-value')).join()})`)
  await shot('settings-dark')

  // ---- folders ----
  await page.locator('.sidebar-new > button').click()
  await page.locator('.new-menu button', { hasText: 'Folder' }).click()
  await page.locator('.sidebar-row input').fill('Home')
  await page.keyboard.press('Enter')
  await drag(row('Shopping'), row('Home'))
  check((await row('Shopping').evaluate((node) => node.style.paddingLeft)) === '24px', 'entry dragged into a folder')
  check((await row('Home').locator('.count').innerText()) === '3', 'folder shows the open tasks of its content')
  await row('Home').click()
  check((await row('Shopping').count()) === 0, 'a click collapses the folder')
  await row('Home').click()
  await row('Shopping').waitFor()

  await row('Home').click({ button: 'right' })
  await page.locator('.menu-add button', { hasText: 'Folder' }).click()
  await page.locator('.sidebar-row input').fill('Outdoor')
  await page.keyboard.press('Enter')
  await drag(row('Garden ideas'), row('Outdoor'))
  check((await row('Garden ideas').evaluate((node) => node.style.paddingLeft)) === '40px', 'entry dragged into a nested folder')
  await drag(row('Outdoor'), row('Shopping'), -8)
  check((await texts('.sidebar-row .sidebar-title')).join() === 'Website relaunch,Home,Outdoor,Garden ideas,Shopping', 'folder with content moved before another entry')
  await drag(row('Home'), row('Outdoor'))
  check((await texts('.sidebar-row .sidebar-title')).join() === 'Website relaunch,Home,Outdoor,Garden ideas,Shopping', 'a folder cannot be dropped into its own content')
  await drag(row('Website relaunch'), page.locator('.sidebar-end'))
  check((await texts('.sidebar-row .sidebar-title')).join() === 'Home,Outdoor,Garden ideas,Shopping,Website relaunch', 'entry dropped below the last row')
  check((await row('Website relaunch').evaluate((node) => node.style.paddingLeft)) === '8px', 'that drop puts the entry on the top level')
  await shot('sidebar-folders-dark')

  await page.locator('.sidebar-tools button[title="Filter entries"]').click()
  await page.locator('.sidebar-filter').fill('shop')
  check((await texts('.sidebar-row .sidebar-title')).join() === 'Shopping', 'the filter narrows the entries')
  await shot('sidebar-filter-dark')
  await page.keyboard.press('Escape')
  check((await page.locator('.sidebar-filter').count()) === 0 && (await page.locator('.sidebar-row').count()) === 5, 'Escape closes the filter and shows everything again')

  // ---- overview ----
  await page.locator('.sidebar-tools button[title="Overview"]').click()
  await page.locator('.due-group').first().waitFor()
  check((await texts('.due-group h3')).map((text) => text.split('\n')[0]).join() === 'Overdue,Next 7 days', 'overview groups the due tasks')
  check((await texts('.due-group .task-title')).join() === 'Design new logo,Coffee beans,Write landing page text', 'overview lists due tasks of all boards and lists')
  check((await texts('.progress-text')).join() === '1 of 4 done,1 of 5 done', `overview shows the progress (${(await texts('.progress-text')).join()})`)
  await shot('overview-dark')
  await page.locator('.due-group .task-row', { hasText: 'Coffee beans' }).locator('.check').click()
  check((await page.locator('.due-group .task-row').count()) === 2, 'a task can be completed on the overview')
  await row('Home').locator('.count', { hasText: '2' }).waitFor()
  check(true, 'the counter in the sidebar follows')
  await page.locator('.due-group .task-row', { hasText: 'Design new logo' }).click()
  await page.locator('.task-panel').waitFor()
  check((await texts('.view-header h1'))[0] === 'Website relaunch', 'a click on a due task opens it in its board')
  await page.keyboard.press('Escape')

  // ---- deleting folders ----
  await row('Outdoor').click({ button: 'right' })
  await page.locator('.menu-row.danger').click()
  await shot('delete-folder-dialog-dark')
  await page.locator('.choice-dialog button', { hasText: 'Keep content' }).click()
  await row('Outdoor').waitFor({ state: 'detached' })
  check((await texts('.sidebar-row .sidebar-title')).join() === 'Home,Shopping,Garden ideas,Website relaunch', 'folder deleted, its content moved one level up')

  await page.locator('.sidebar-new > button').click()
  await page.locator('.new-menu button', { hasText: 'Folder' }).click()
  await page.locator('.sidebar-row input').fill('Temp')
  await page.keyboard.press('Enter')
  await row('Temp').click({ button: 'right' })
  await page.locator('.menu-add button', { hasText: 'Note' }).click()
  await page.locator('.sidebar-row input').fill('Temp note')
  await page.keyboard.press('Enter')
  await row('Temp').click({ button: 'right' })
  await page.locator('.menu-row.danger').click()
  await page.locator('.choice-dialog button', { hasText: 'Delete content too' }).click()
  await row('Temp').waitFor({ state: 'detached' })
  check((await row('Temp note').count()) === 0 && (await row('Temp').count()) === 0, 'folder deleted together with its content')
  check((await page.locator('.overview-body').count()) === 1, 'the overview opens when the open entry was deleted')
  // deleting an entry while the overview is open removes its due tasks there
  await row('Website relaunch').click({ button: 'right' })
  await page.locator('.menu-row.danger').click()
  await page.locator('.due-group').first().waitFor({ state: 'detached' })
  check(true, 'due tasks of a deleted board leave the overview')
  await page.keyboard.press('Control+Z')
  await page.locator('.column').first().waitFor()
  await page.locator('.sidebar-tools button[title="Overview"]').click()
  await page.locator('.due-group .task-row', { hasText: 'Design new logo' }).waitFor()
  check(true, 'Undo brings the board and its due tasks back')
  await page.keyboard.press('Control+Z')
  await row('Temp note').waitFor()
  check(true, 'a second Undo brings the folder and its content back')
  await row('Temp').click({ button: 'right' })
  await page.locator('.menu-row.danger').click()
  await page.locator('.choice-dialog button', { hasText: 'Delete content too' }).click()
  await row('Temp').waitFor({ state: 'detached' })

  // ---- command line tool for AI agents, and HTML pages ----
  const reportFile = join(dataDir, 'report.html')
  writeFileSync(
    reportFile,
    `<div class="chips"><span class="chip accent">Weekly</span><span class="chip">2 projects</span></div>
<h1>Weekly summary: <em>7 tasks</em> still open</h1>
<p>Written by an agent through the command line tool.</p>
<div class="stats">
  <div class="stat"><b>7</b><span>open tasks</span></div>
  <div class="stat accent"><b>2</b><span>done this week</span></div>
  <div class="stat bad"><b>1</b><span>overdue</span></div>
</div>
<h2>Open tasks <em>per entry</em></h2>
<div class="bars">
  <div class="bar"><b>Website relaunch<small>board</small></b><div><i style="width:80%">4</i></div><span>4</span></div>
  <div class="bar"><b>Shopping<small>list</small></b><div><i class="wait" style="width:40%"><span>2</span></i></div><span>2</span></div>
</div>
<h3>Results</h3>
<table><tr><th>Topic</th><th>State</th></tr><tr><td>Landing page</td><td>in progress</td></tr><tr><td>Zebra stripes</td><td>done</td></tr></table>
<p><a href="https://example.com">A link that must not leave the app</a></p>
<p id="by-script"></p>
<script>document.getElementById('by-script').textContent = 'filled in by a script'</script>`
  )
  const created = JSON.parse(cli('createPage', 'Agent report', 'null', `@${reportFile}`))
  await row('Agent report').waitFor()
  check(true, 'a page created by the command line tool shows up in the running app')
  await row('Agent report').click()
  const frame = page.frameLocator('.page-frame')
  await frame.locator('h1').waitFor()
  check((await frame.locator('h1').innerText()).startsWith('WEEKLY SUMMARY'), 'the page shows its HTML in the house style')
  check((await frame.locator('#by-script').innerText()) === 'filled in by a script', 'scripts inside a page run')
  check((await frame.locator('body').evaluate(() => Boolean(window.api) || window.parent === window)) === false, 'but a page script has no line to the app')
  // Catch the call that would open the real browser during this test.
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      globalThis.openedUrl = url
    }
  })
  await frame.locator('a').click()
  await page.waitForTimeout(500)
  check((await app.evaluate(() => globalThis.openedUrl)) === 'https://example.com/', 'a link inside a page is handed to the browser')
  check((await frame.locator('h1').count()) === 1, 'and the page itself stays as it is')
  await shot('page-dark')

  cli('savePage', String(created.id), '<h1>Changed by the agent</h1>')
  await frame.locator('h1', { hasText: 'Changed by the agent' }).waitFor()
  check(true, 'a change by the command line tool reaches the open page')
  await page.locator('.view-header button', { hasText: 'Edit HTML' }).click()
  await page.locator('.page-source').fill('<h1>Changed by hand</h1><p>zebra</p>')
  await page.locator('.view-header button', { hasText: 'Show page' }).click()
  await frame.locator('h1', { hasText: 'Changed by hand' }).waitFor()
  check(cli('getPage', String(created.id)).includes('Changed by hand'), 'the user can edit the HTML and the tool reads it back')
  check(JSON.parse(cli('search', 'zebra')).length === 1, 'the search finds text inside pages')

  const board = JSON.parse(cli('listItems')).find((item) => item.title === 'Website relaunch')
  const columns = JSON.parse(cli('getBoard', String(board.id))).columns
  const cliTask = JSON.parse(cli('createTask', String(board.id), String(columns[0].id), 'Task from the agent'))
  cli('updateTask', String(cliTask.id), 'priority=high', `dueDate=${day(2)}`)
  await row('Website relaunch').click()
  await page.locator('.card', { hasText: 'Task from the agent' }).locator('.pill.priority-high').waitFor()
  check(true, 'a task created and changed by the tool shows up in the open board')
  cli('deleteTask', String(cliTask.id))
  await page.locator('.card', { hasText: 'Task from the agent' }).waitFor({ state: 'detached' })

  const noteItem = JSON.parse(cli('createNote', 'Agent note', 'null', '# From Markdown\n\n- [x] first\n- [ ] second'))
  await row('Agent note').click()
  await page.locator('.note-content h1', { hasText: 'From Markdown' }).waitFor()
  check((await page.locator('.note-content ul[data-type="taskList"] li').count()) === 2, 'a note written as Markdown is formatted in the editor')
  cli('setNoteMarkdown', String(noteItem.id), '# Updated by the agent')
  await page.locator('.note-content h1', { hasText: 'Updated by the agent' }).waitFor()
  check(true, 'a change by the tool reaches the open note')
  cli('deleteItem', String(noteItem.id), 'false')
  await row('Agent note').waitFor({ state: 'detached' })
  check(true, 'an entry deleted by the tool leaves the sidebar')
  check(cli('tree').includes('page  Agent report'), 'the tool lists everything with ids')

  // ---- the whole app in the browser ----
  // shell.openExternal is still caught from the link test above, so no real browser opens.
  await row('Shopping').click()
  await page.locator('.view-header button[title="Open in browser"]').click()
  await page.waitForTimeout(700)
  const webUrl = await app.evaluate(() => globalThis.openedUrl)
  check(/^http:\/\/127\.0\.0\.1:\d+\/#key=[0-9a-f]+&item=\d+$/.test(webUrl), 'the browser button starts a server on this computer and opens an address with a key')
  const origin = new URL(webUrl).origin
  check((await app.evaluate(async (_, url) => (await fetch(url)).status, origin + '/changes')) === 403, 'without the key the server gives out no data')

  // A second plain window stands in for the browser: it has no direct line to the app.
  const [web] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(({ BrowserWindow }, url) => {
      new BrowserWindow({ width: 1100, height: 760 }).loadURL(url)
    }, webUrl)
  ])
  web.on('pageerror', (error) => console.log('[browser crash]', error.message))
  await web.waitForSelector('.sidebar')
  await web.locator('.task-row').first().waitFor()
  check((await web.locator('.view-header h1').innerText()) === 'Shopping', 'the browser shows the app, opened on the same entry')
  check(!web.url().includes('key='), 'the key is taken out of the address after loading')
  check((await web.locator('.view-header button[title="Open in browser"]').count()) === 0, 'inside the browser there is no browser button')

  await web.locator('.task-row', { hasText: 'Garden soil' }).locator('.check').click()
  await page.locator('.task-row.done', { hasText: 'Garden soil' }).waitFor()
  check(true, 'a task ticked in the browser is ticked in the app')
  await page.locator('.add-task input').fill('Added in the app')
  await page.keyboard.press('Enter')
  await web.locator('.task-row', { hasText: 'Added in the app' }).waitFor()
  check(true, 'a task added in the app shows up in the browser')
  await web.locator('.add-task input').fill('Added in the browser')
  await web.keyboard.press('Enter')
  await page.locator('.task-row', { hasText: 'Added in the browser' }).waitFor()
  check(true, 'a task added in the browser shows up in the app')

  await web.locator('.sidebar-row', { hasText: 'Agent report' }).click()
  await web.frameLocator('.page-frame').locator('h1').waitFor()
  check(true, 'an HTML page is shown in the browser too')
  await web.locator('.sidebar-row', { hasText: 'Garden ideas' }).click()
  await web.locator('.note-content').click()
  await web.keyboard.press('Control+End')
  await web.keyboard.type('Typed in the browser')
  await row('Garden ideas').click()
  await page.locator('.note-content', { hasText: 'Typed in the browser' }).waitFor()
  check(true, 'text typed into a note in the browser reaches the app')
  await web.locator('.sidebar-row', { hasText: 'Website relaunch' }).click()
  await web.locator('.column').first().waitFor()
  await web.waitForTimeout(250)
  await web.screenshot({ path: join(outDir, 'browser-view.png') })
  await web.close()

  // ---- linked local files ----
  const linked = join(dataDir, 'linked')
  mkdirSync(join(linked, 'site'), { recursive: true })
  const mdFile = join(linked, 'meeting.md')
  const htmlFile = join(linked, 'site', 'index.html')
  const pdfFile = join(linked, 'paper.pdf')
  writeFileSync(mdFile, '# Meeting notes\n\n- first point\n')
  writeFileSync(htmlFile, '<link rel="stylesheet" href="style.css"><h1 id="title">plain</h1><script src="app.js"></script>')
  writeFileSync(join(linked, 'site', 'style.css'), 'body { background: #102030; color: white; font-family: sans-serif } h1 { color: rgb(255, 0, 0) }')
  writeFileSync(join(linked, 'site', 'app.js'), "document.getElementById('title').textContent = 'set by its own script'")
  // A small but complete PDF, built here with correct positions for each part.
  const pdfParts = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    '<</Length 47>>\nstream\nBT /F1 28 Tf 40 100 Td (Hello from a PDF) Tj ET\nendstream',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = pdfParts.map((part, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${part}\nendobj\n`
    return offset
  })
  const xref = pdf.length
  const table = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `xref\n0 ${pdfParts.length + 1}\n0000000000 65535 f \n${table}`
  pdf += `trailer\n<</Size ${pdfParts.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  writeFileSync(pdfFile, pdf)
  // The file dialog cannot be clicked from here, so it answers by itself.
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, [mdFile, htmlFile, pdfFile])
  await page.locator('.sidebar-new > button').click()
  await page.locator('.new-menu button', { hasText: 'File' }).click()
  await row('paper.pdf').waitFor()
  check((await row('meeting.md').count()) === 1 && (await row('index.html').count()) === 1, 'local files are linked into the sidebar under their names')

  await row('meeting.md').click()
  await page.locator('.note-content h1', { hasText: 'Meeting notes' }).waitFor()
  check(readFileSync(mdFile, 'utf8') === '# Meeting notes\n\n- first point\n', 'opening a Markdown file does not change it')
  await page.locator('.note-content li', { hasText: 'first point' }).click()
  // The editor takes over the clicked position a moment after the click.
  await page.waitForTimeout(300)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second point from Slateforge')
  await page.waitForTimeout(900)
  const written = readFileSync(mdFile, 'utf8')
  check(written.includes('# Meeting notes') && written.includes('first point') && written.includes('- second point from Slateforge'), 'editing a Markdown file writes it back as Markdown')
  writeFileSync(mdFile, '# Changed outside\n')
  cli('listItems')
  await row('index.html').click()
  await row('meeting.md').click()
  await page.locator('.note-content h1', { hasText: 'Changed outside' }).waitFor()
  check(true, 'a Markdown file changed outside shows its new text')
  await shot('file-markdown')

  await row('index.html').click()
  const fileFrame = page.frameLocator('.page-frame')
  await fileFrame.locator('#title', { hasText: 'set by its own script' }).waitFor()
  check((await fileFrame.locator('#title').evaluate((node) => getComputedStyle(node).color)) === 'rgb(255, 0, 0)', 'an HTML file runs its scripts and loads the styles next to it')
  await shot('file-html')

  await row('paper.pdf').click()
  await page.locator('iframe.page-frame').waitFor()
  await page.waitForTimeout(1500)
  await shot('file-pdf')

  const linkedItems = JSON.parse(cli('listItems')).filter((item) => item.type === 'file')
  check(linkedItems.length === 3, 'the command line tool sees the linked files')
  for (const item of linkedItems) cli('deleteItem', String(item.id), 'false')
  await row('paper.pdf').waitFor({ state: 'detached' })
  check(readFileSync(pdfFile).length > 0 && readFileSync(htmlFile).length > 0, 'deleting the entries leaves the files on disk')

  // ---- pinning ----
  await row('Shopping').click({ button: 'right' })
  await page.locator('.menu-row', { hasText: 'Pin to top' }).click()
  await page.keyboard.press('Escape')
  await page.locator('.sidebar-row.pinned', { hasText: 'Shopping' }).waitFor()
  check((await texts('.sidebar-row .sidebar-title'))[0] === 'Shopping', 'a pinned entry is listed at the top of the sidebar')
  cli('updateItem', String(created.id), 'pinned=true')
  await page.locator('.sidebar-row.pinned', { hasText: 'Agent report' }).waitFor()
  check(true, 'the tool can pin entries too')
  await shot('pinned-dark')
  await page.locator('.sidebar-row.pinned', { hasText: 'Agent report' }).click()
  await frame.locator('h1').waitFor()
  await shot('page-house-style')
  await page.locator('.sidebar-row.pinned', { hasText: 'Shopping' }).click({ button: 'right' })
  await page.locator('.menu-row', { hasText: 'Unpin' }).click()
  await page.keyboard.press('Escape')
  cli('updateItem', String(created.id), 'pinned=false')
  await page.locator('.sidebar-row.pinned').first().waitFor({ state: 'detached' })
  check((await page.locator('.sidebar-row.pinned').count()) === 0, 'unpinning removes it from the top')
  cli('deleteItem', String(created.id), 'false')
  await row('Agent report').waitFor({ state: 'detached' })

  // ---- black theme ----
  await setTheme('Black')
  await shot('settings-black')
  await page.locator('.sidebar-row', { hasText: 'Website relaunch' }).click()
  await page.locator('.card', { hasText: 'Write landing page text' }).click()
  await shot('board-with-task-panel-black')
  await page.keyboard.press('Escape')
  await page.locator('.sidebar-row', { hasText: 'Shopping' }).click()
  await shot('list-black')
  await page.locator('.sidebar-row', { hasText: 'Garden ideas' }).click()
  await page.locator('.note-content h1').waitFor()
  await shot('note-black')
  await page.keyboard.press('Control+K')
  await page.locator('.search-input input').fill('garden')
  await page.locator('.search-results li').first().waitFor()
  await shot('search-black')
  await page.keyboard.press('Escape')

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
  check((await texts('.sidebar-row .sidebar-title')).join() === 'Home,Shopping,Garden ideas,Website relaunch', 'folders, entries and their order survive a restart')
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
