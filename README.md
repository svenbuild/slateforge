<img src="assets/icon.svg" width="64" height="64" alt="">

# Slateforge

A Windows desktop app to organize tasks and notes. All data stays on your
computer: no cloud, no account.

## Features

- **Sidebar** with boards, lists and notes. Each entry has its own icon and
  color, can be renamed in place (double click or F2) and reordered by drag and
  drop. The app opens the entry you used last.
- **Folders** group entries and can be nested as deep as you like. Drag an
  entry onto a folder to move it in. A number next to each entry and folder
  shows the open tasks, and a filter narrows the sidebar by name.
- **Overview** page with everything that is overdue or due in the next 7 days
  across all boards and lists, plus the progress of each board and list.
- **Boards**: kanban columns and tasks, both movable by drag and drop.
- **Lists**: checkable tasks, sorted manually, by due date or by priority.
  Completed tasks are shown separately.
- **Tasks**: title, description, priority, due date and done state, edited in
  a side panel.
- **Notes**: editor with live formatting (`# ` heading, `- ` list, `[ ] `
  checklist). Pasted Markdown text is formatted automatically.
- **Search** over everything with `Ctrl+K`, usable with the keyboard only.
- **Trash and undo**: deleted things go to the trash. `Ctrl+Z` or the "Undo"
  button brings back the last deleted thing.
- **Pages** hold free HTML, for summaries, overviews and reports. You can
  edit the HTML in the app. All pages share one house style, defined in
  `assets/page-style.html`.
- **Open in browser**: a small button in the header opens the whole app in
  your browser, on the current entry. Everything works there as in the app,
  and both sides show each other's changes within about a second. For this
  the app starts a small web server with the first click. It only listens on
  this computer (127.0.0.1) and needs the secret key in the address.
- **Pin** entries to keep them at the top of the sidebar.
- **Command line tool** for scripts and AI agents, see below.
- **Own title bar** with the search in the middle.
- **Settings**: light, dark, black or system design, statistics and the location of
  the data file.

## Run from source

Needs [Node.js](https://nodejs.org) 22 or newer.

```
npm install
npx install-electron   # downloads the Electron program once
npm run dev            # start with live reload
```

Other commands:

| Command               | What it does                                             |
| --------------------- | -------------------------------------------------------- |
| `npm test`            | Unit tests for the database and the ordering logic       |
| `npm run typecheck`   | TypeScript check                                         |
| `npm run build`       | Build the app into `out/`                                |
| `npm start`           | Start the built app                                      |
| `npm run screenshots` | Click through the built app and save screenshots         |
| `npm run package`     | Create `dist/Slateforge-win32-x64/Slateforge.exe`        |

The packaged folder can be copied anywhere. Start `Slateforge.exe` inside it.

## Command line tool for AI agents

`bin\slateforge.cmd` does everything the app can do: create, change, move and
delete boards, lists, notes, pages, folders and tasks. It works on the same
data file, and the running app shows the changes within about a second.

```
bin\slateforge help
bin\slateforge tree
bin\slateforge createPage "Weekly report" null @C:\tmp\report.html
bin\slateforge updateTask 12 done=true
```

It needs Node.js and a built app (`npm run build`).

## Where the data lives

One SQLite file: `%APPDATA%\Slateforge\slateforge.db` (the exact path is shown
in the settings). Copy this file to make a backup.

## Code overview

| Path              | Content                                                       |
| ----------------- | ------------------------------------------------------------- |
| `src/main`        | Electron main process: window, database (`db.ts`)             |
| `src/preload`     | Bridge that gives the window access to the API                |
| `src/shared`      | Types and pure logic used on both sides (`logic.ts`)          |
| `src/renderer`    | The user interface (React)                                    |
| `tests`           | Unit tests                                                    |
| `scripts`         | Screenshot click-through, packaging, icon generation          |
