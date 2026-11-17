import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Ellipsis, Pencil, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { moveId } from '../../shared/logic'
import { ITEM_TYPES, type Item, type ItemPatch, type ItemType } from '../../shared/types'
import { COLORS, ICONS, ItemIcon, TYPE_LABEL, colorKey, iconKey } from './icons'
import { InlineEdit } from './ui'

interface MenuState {
  item: Item
  top: number
  left: number
}

// Small popup of one entry: rename, icon, color, delete.
function ItemMenu(props: {
  menu: MenuState
  onUpdate: (patch: ItemPatch) => void
  onRename: () => void
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

function SidebarRow(props: {
  item: Item
  active: boolean
  renaming: boolean
  onRenaming: (renaming: boolean) => void
  onOpen: () => void
  onRename: (title: string) => void
  onMenu: (anchor: DOMRect) => void
}) {
  const { item } = props
  const sortable = useSortable({ id: item.id })
  const style = {
    transform: CSS.Translate.toString(sortable.transform && { ...sortable.transform, x: 0 }),
    transition: sortable.transition
  }
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={`sidebar-row ${props.active ? 'active' : ''} ${sortable.isDragging ? 'dragging' : ''}`}
      onClick={props.onOpen}
      onContextMenu={(event) => {
        event.preventDefault()
        props.onMenu(event.currentTarget.getBoundingClientRect())
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onOpen()
        if (event.key === 'F2') props.onRenaming(true)
      }}
      {...sortable.attributes}
      {...(props.renaming ? {} : sortable.listeners)}
    >
      <ItemIcon item={item} />
      <InlineEdit
        className="sidebar-title"
        value={item.title}
        editing={props.renaming}
        onEditing={props.onRenaming}
        onCommit={props.onRename}
      />
      {!props.renaming && (
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
      )}
    </li>
  )
}

export function Sidebar(props: {
  items: Item[]
  activeId: number | null
  activeKind: string
  renamingId: number | null
  onRenaming: (id: number | null) => void
  onOpen: (id: number) => void
  onCreate: (type: ItemType) => void
  onUpdate: (id: number, patch: ItemPatch) => void
  onReorder: (orderedIds: number[]) => void
  onDelete: (item: Item) => void
  onSearch: () => void
  onSettings: () => void
  onTrash: () => void
}) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  // The menu shows the current state of its entry, also after a change.
  const menuItem = menu && props.items.find((item) => item.id === menu.item.id)

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return
    const ids = props.items.map((item) => item.id)
    props.onReorder(moveId(ids, Number(active.id), ids.indexOf(Number(over.id))))
  }

  const openMenu = (item: Item, anchor: DOMRect): void => {
    // Keep the popup inside the window.
    const top = Math.min(anchor.bottom + 4, window.innerHeight - 380)
    setMenu({ item, top: Math.max(8, top), left: anchor.left })
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">Slateforge</div>

      <button type="button" className="search-button" onClick={props.onSearch}>
        <Search size={15} />
        Search
        <kbd>Ctrl K</kbd>
      </button>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={props.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ul className="sidebar-items">
            {props.items.map((item) => (
              <SidebarRow
                key={item.id}
                item={item}
                active={props.activeId === item.id}
                renaming={props.renamingId === item.id}
                onRenaming={(renaming) => props.onRenaming(renaming ? item.id : null)}
                onOpen={() => props.onOpen(item.id)}
                onRename={(title) => props.onUpdate(item.id, { title })}
                onMenu={(anchor) => openMenu(item, anchor)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="sidebar-new">
        {ITEM_TYPES.map((type) => (
          <button key={type} type="button" className="ghost-button" title={`New ${type}`} onClick={() => props.onCreate(type)}>
            <Plus size={14} />
            {TYPE_LABEL[type]}
          </button>
        ))}
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
