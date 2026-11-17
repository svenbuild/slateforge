import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent
} from '@dnd-kit/core'
import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  LayoutDashboard,
  ListFilter,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings,
  Trash2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { descendantIds, resolveDrop, treeRows, type DropMode } from '../../shared/logic'
import { ITEM_TYPES, type Item, type ItemPatch, type ItemType, type Progress } from '../../shared/types'
import { COLORS, ICONS, ItemIcon, TYPE_LABEL, colorKey, iconKey } from './icons'
import { InlineEdit } from './ui'

const END_ZONE = 'end'
const INDENT_PX = 16

interface MenuState {
  item: Item
  top: number
  left: number
}

// Where the dragged item would land. A target of null is the end of the top level.
interface Drop {
  targetId: number | null
  mode: DropMode
}

// Small popup of one item: rename, icon, color, delete. Folders can also get new content.
function ItemMenu(props: {
  menu: MenuState
  onUpdate: (patch: ItemPatch) => void
  onRename: () => void
  onCreate: (type: ItemType) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { item } = props.menu
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) props.onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      props.onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  })

  return (
    <div ref={ref} className="item-menu" style={{ top: props.menu.top, left: props.menu.left }}>
      <button type="button" className="menu-row" onClick={props.onRename}>
        <Pencil size={14} />
        Rename
      </button>
      {item.type !== 'folder' && (
        <button type="button" className="menu-row" onClick={() => props.onUpdate({ pinned: !item.pinned })}>
          {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          {item.pinned ? 'Unpin' : 'Pin to top'}
        </button>
      )}
      {item.type === 'folder' && (
        <>
          <div className="menu-label">Add to this folder</div>
          <div className="menu-add">
            {ITEM_TYPES.map((type) => (
              <button key={type} type="button" className="ghost-button" onClick={() => props.onCreate(type)}>
                <Plus size={13} />
                {TYPE_LABEL[type]}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="menu-label">Icon</div>
      <div className="icon-grid">
        {Object.entries(ICONS).map(([key, Icon]) => (
          <button
            key={key}
            type="button"
            title={key}
            className={iconKey(item) === key ? 'active' : ''}
            onClick={() => props.onUpdate({ icon: key })}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      <div className="menu-label">Color</div>
      <div className="color-row">
        {Object.entries(COLORS).map(([key, value]) => (
          <button
            key={key}
            type="button"
            title={key}
            className={colorKey(item) === key ? 'active' : ''}
            style={{ background: value }}
            onClick={() => props.onUpdate({ color: key })}
          />
        ))}
      </div>
      <button type="button" className="menu-row danger" onClick={props.onDelete}>
        <Trash2 size={14} />
        Delete
      </button>
    </div>
  )
}

function RowContent({ item, openTasks }: { item: Item; openTasks: number }) {
  return (
    <>
      {item.type === 'folder' && (item.collapsed ? <ChevronRight size={14} className="chevron" /> : <ChevronDown size={14} className="chevron" />)}
      <ItemIcon item={item} />
      <span className="inline-text sidebar-title">{item.title}</span>
      {openTasks > 0 && <span className="count">{openTasks}</span>}
    </>
  )
}

function SidebarRow(props: {
  item: Item
  depth: number
  openTasks: number
  active: boolean
  renaming: boolean
  draggable: boolean
  dropMode: DropMode | null
  onRenaming: (renaming: boolean) => void
  onOpen: () => void
  onRename: (title: string) => void
  onMenu: (anchor: DOMRect) => void
}) {
  const { item } = props
  const draggable = useDraggable({ id: item.id })
  const droppable = useDroppable({ id: item.id })
  const classes = [
    'sidebar-row',
    props.active ? 'active' : '',
    draggable.isDragging ? 'dragging' : '',
    props.dropMode ? `drop-${props.dropMode}` : ''
  ]
  return (
    <li
      ref={(node) => {
        draggable.setNodeRef(node)
        droppable.setNodeRef(node)
      }}
      style={{ paddingLeft: 8 + props.depth * INDENT_PX }}
      className={classes.join(' ')}
      // Files dragged in from outside land in this folder.
      data-drop-folder={item.type === 'folder' ? item.id : (item.parentId ?? '')}
      onClick={props.onOpen}
      onDoubleClick={() => props.onRenaming(true)}
      onContextMenu={(event) => {
        event.preventDefault()
        props.onMenu(event.currentTarget.getBoundingClientRect())
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onOpen()
        if (event.key === 'F2') props.onRenaming(true)
      }}
      {...draggable.attributes}
      {...(props.draggable && !props.renaming ? draggable.listeners : {})}
    >
      {props.renaming ? (
        <>
          <ItemIcon item={item} />
          <InlineEdit
            className="sidebar-title"
            value={item.title}
            editing
            onEditing={props.onRenaming}
            onCommit={props.onRename}
          />
        </>
      ) : (
        <>
          <RowContent item={item} openTasks={props.openTasks} />
          <button
            type="button"
            className="icon-button row-menu"
            title="Rename, icon, color, delete"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              props.onMenu(event.currentTarget.getBoundingClientRect())
            }}
          >
            <Ellipsis size={15} />
          </button>
        </>
      )}
    </li>
  )
}

// Empty strip below the last row: dropping here moves an item to the end of the top level.
function EndZone({ active }: { active: boolean }) {
  const droppable = useDroppable({ id: END_ZONE })
  return <li ref={droppable.setNodeRef} className={`sidebar-end ${active ? 'drop-before' : ''}`} />
}

export function Sidebar(props: {
  items: Item[]
  progress: Progress[]
  activeId: number | null
  activeKind: string
  renamingId: number | null
  onRenaming: (id: number | null) => void
  onOpen: (id: number) => void
  onCreate: (type: ItemType, parentId: number | null) => void
  onUpdate: (id: number, patch: ItemPatch) => void
  onMove: (id: number, parentId: number | null, index: number) => void
  onDelete: (item: Item) => void
  onOverview: () => void
  onSettings: () => void
  onTrash: () => void
}) {
  const { items } = props
  const [menu, setMenu] = useState<MenuState | null>(null)
  // The filter field is hidden until its button is used. An empty string means no filter.
  const [filterOpen, setFilterOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  // Place of the "New" menu on screen while it is open.
  const [newMenu, setNewMenu] = useState<{ top: number; left: number } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  // Where the mouse really is. The drag events only report a distance, and
  // that distance is wrong once the list has scrolled during a drag.
  const pointerY = useRef(0)
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      pointerY.current = event.clientY
    }
    window.addEventListener('pointermove', onMove, true)
    return () => window.removeEventListener('pointermove', onMove, true)
  }, [])
  // The menu shows the current state of its item, also after a change.
  const menuItem = menu && items.find((item) => item.id === menu.item.id)
  const dragItem = items.find((item) => item.id === dragId)

  // With a filter the matching entries are shown as a plain list without folders.
  const needle = filter.trim().toLowerCase()
  const rows =
    needle === ''
      ? treeRows(items)
      : items
          .filter((item) => item.type !== 'folder' && item.title.toLowerCase().includes(needle))
          .map((item) => ({ item, depth: 0 }))

  // Open tasks of an entry. A folder shows the sum of everything inside it.
  const openOf = new Map(props.progress.map((entry) => [entry.itemId, entry.total - entry.done]))
  const openTasks = (item: Item): number =>
    item.type === 'folder'
      ? descendantIds(items, item.id).reduce((sum, id) => sum + (openOf.get(id) ?? 0), 0)
      : (openOf.get(item.id) ?? 0)

  // The upper part of a row means "before it". The rest means "into it" for
  // a folder and "after it" for everything else.
  const findDrop = ({ active, over }: Pick<DragMoveEvent, 'active' | 'over'>): Drop | null => {
    if (!over) return null
    let found: Drop = { targetId: null, mode: 'after' }
    if (over.id !== END_ZONE) {
      const target = items.find((item) => item.id === over.id)
      const ratio = (pointerY.current - over.rect.top) / over.rect.height
      const lower: DropMode = target?.type === 'folder' ? 'into' : 'after'
      found = { targetId: Number(over.id), mode: ratio < (lower === 'into' ? 0.3 : 0.5) ? 'before' : lower }
    }
    return resolveDrop(items, Number(active.id), found.targetId, found.mode) ? found : null
  }

  const onDragMove = (event: DragMoveEvent): void => {
    const next = findDrop(event)
    setDrop((current) => (current?.targetId === next?.targetId && current?.mode === next?.mode ? current : next))
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const target = findDrop(event)
    const place = target && resolveDrop(items, Number(event.active.id), target.targetId, target.mode)
    if (place) props.onMove(Number(event.active.id), place.parentId, place.index)
    setDragId(null)
    setDrop(null)
  }

  const onDragCancel = (): void => {
    setDragId(null)
    setDrop(null)
  }

  const closeFilter = (): void => {
    setFilter('')
    setFilterOpen(false)
  }

  const openMenu = (item: Item, anchor: DOMRect): void => {
    // Keep the popup inside the window.
    const height = item.type === 'folder' ? 470 : 380
    const top = Math.min(anchor.bottom + 4, window.innerHeight - height)
    setMenu({ item, top: Math.max(8, top), left: anchor.left })
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-tools">
        Entries
        <button
          type="button"
          className={`icon-button ${props.activeKind === 'overview' ? 'active' : ''}`}
          title="Overview"
          onClick={props.onOverview}
        >
          <LayoutDashboard size={15} />
        </button>
        <button
          type="button"
          className={`icon-button ${filterOpen ? 'active' : ''}`}
          title="Filter entries"
          onClick={() => (filterOpen ? closeFilter() : setFilterOpen(true))}
        >
          <ListFilter size={15} />
        </button>
      </div>

      {filterOpen && (
        <input
          className="sidebar-filter"
          autoFocus
          value={filter}
          placeholder="Filter entries"
          maxLength={100}
          onChange={(event) => setFilter(event.target.value)}
          onBlur={() => filter.trim() === '' && closeFilter()}
          onKeyDown={(event) => event.key === 'Escape' && closeFilter()}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => setDragId(Number(active.id))}
        onDragMove={onDragMove}
        onDragOver={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <ul className="sidebar-items">
          {needle === '' &&
            items
              .filter((item) => item.pinned && item.type !== 'folder')
              .map((item) => (
                <li
                  key={item.id}
                  className={`sidebar-row pinned ${props.activeId === item.id ? 'active' : ''}`}
                  onClick={() => props.onOpen(item.id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openMenu(item, event.currentTarget.getBoundingClientRect())
                  }}
                >
                  <RowContent item={item} openTasks={openTasks(item)} />
                  <Pin size={12} className="pin-mark" />
                </li>
              ))}
          {needle === '' && items.some((item) => item.pinned && item.type !== 'folder') && <li className="sidebar-divider" />}
          {rows.map(({ item, depth }) => (
            <SidebarRow
              key={item.id}
              item={item}
              depth={depth}
              openTasks={openTasks(item)}
              active={props.activeId === item.id}
              renaming={props.renamingId === item.id}
              draggable={needle === ''}
              dropMode={drop?.targetId === item.id ? drop.mode : null}
              onRenaming={(renaming) => props.onRenaming(renaming ? item.id : null)}
              onOpen={() =>
                item.type === 'folder' ? props.onUpdate(item.id, { collapsed: !item.collapsed }) : props.onOpen(item.id)
              }
              onRename={(title) => props.onUpdate(item.id, { title })}
              onMenu={(anchor) => openMenu(item, anchor)}
            />
          ))}
          {needle === '' && <EndZone active={drop !== null && drop.targetId === null} />}
          {needle !== '' && rows.length === 0 && <li className="sidebar-empty">No entry matches.</li>}
        </ul>
        <DragOverlay dropAnimation={null}>
          {dragItem && (
            <div className="sidebar-row overlay">
              <RowContent item={dragItem} openTasks={0} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div className="sidebar-new">
        <button
          type="button"
          className="ghost-button"
          onClick={(event) => {
            // Below the button, but never past the lower edge of the window.
            const anchor = event.currentTarget.getBoundingClientRect()
            setNewMenu({ top: Math.min(anchor.bottom + 4, window.innerHeight - 190), left: anchor.left })
          }}
        >
          <Plus size={14} />
          New
        </button>
        {newMenu && (
          <>
            <div className="menu-backdrop" onMouseDown={() => setNewMenu(null)} />
            <div className="item-menu new-menu" style={newMenu}>
              {ITEM_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="menu-row"
                  onClick={() => {
                    setNewMenu(null)
                    props.onCreate(type, null)
                  }}
                >
                  <ItemIcon item={{ type, icon: '', color: '' }} />
                  {TYPE_LABEL[type]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <button type="button" className={`sidebar-link ${props.activeKind === 'trash' ? 'active' : ''}`} onClick={props.onTrash}>
          <Trash2 size={15} />
          Trash
        </button>
        <button type="button" className={`sidebar-link ${props.activeKind === 'settings' ? 'active' : ''}`} onClick={props.onSettings}>
          <Settings size={15} />
          Settings
        </button>
      </div>

      {menu && menuItem && (
        <ItemMenu
          menu={{ ...menu, item: menuItem }}
          onUpdate={(patch) => props.onUpdate(menuItem.id, patch)}
          onRename={() => {
            setMenu(null)
            props.onRenaming(menuItem.id)
          }}
          onCreate={(type) => {
            setMenu(null)
            props.onCreate(type, menuItem.id)
          }}
          onDelete={() => {
            setMenu(null)
            props.onDelete(menuItem)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  )
}
