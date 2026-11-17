import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { moveId, placeTask } from '../../shared/logic'
import type { Column, Task } from '../../shared/types'
import { api } from './api'
import { TaskPanel } from './TaskPanel'
import { Checkbox, InlineEdit, TaskMeta, ViewHeader, useScrollToSelected, useTaskActions, type ViewProps } from './ui'

// Drag ids are strings so columns and tasks cannot be mixed up.
const columnDragId = (id: number): string => `column-${id}`
const taskDragId = (id: number): string => `task-${id}`
const idOf = (dragId: string | number): number => Number(String(dragId).split('-')[1])
const isColumn = (dragId: string | number): boolean => String(dragId).startsWith('column-')

// Columns only compare with columns. A task first finds the column below the
// pointer and then the closest card inside that column.
const collisionDetection: CollisionDetection = (args) => {
  const columns = args.droppableContainers.filter((container) => isColumn(container.id))
  if (isColumn(args.active.id)) return closestCenter({ ...args, droppableContainers: columns })
  const hit =
    pointerWithin({ ...args, droppableContainers: columns })[0] ??
    closestCenter({ ...args, droppableContainers: columns })[0]
  if (!hit) return []
  const cards = args.droppableContainers.filter(
    (container) => !isColumn(container.id) && container.data.current?.columnId === idOf(hit.id)
  )
  return cards.length > 0 ? closestCenter({ ...args, droppableContainers: cards }) : [hit]
}

function CardContent({ task, onToggle }: { task: Task; onToggle: (done: boolean) => void }) {
  return (
    <>
      <Checkbox checked={task.done} onChange={onToggle} label={`Done: ${task.title}`} />
      <div className="card-text">
        <span className="task-title">{task.title}</span>
        <TaskMeta task={task} />
      </div>
    </>
  )
}

function TaskCard(props: { task: Task; selected: boolean; onOpen: () => void; onToggle: (done: boolean) => void }) {
  const { task } = props
  const sortable = useSortable({ id: taskDragId(task.id), data: { columnId: task.columnId } })
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`card ${props.selected ? 'selected' : ''} ${task.done ? 'done' : ''} ${sortable.isDragging ? 'dragging' : ''}`}
      onClick={props.onOpen}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <CardContent task={task} onToggle={props.onToggle} />
    </div>
  )
}

function BoardColumn(props: {
  column: Column
  tasks: Task[]
  startEditing: boolean
  selectedId: number | null
  onOpenTask: (id: number) => void
  onToggleTask: (id: number, done: boolean) => void
  onAddTask: (title: string) => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const { column, tasks } = props
  const [editing, setEditing] = useState(props.startEditing)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const sortable = useSortable({ id: columnDragId(column.id) })
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }

  const addTask = (event: FormEvent): void => {
    event.preventDefault()
    const title = newTitle.trim()
    if (title === '') return
    setNewTitle('')
    props.onAddTask(title)
  }

  return (
    <section ref={sortable.setNodeRef} style={style} className={`column ${sortable.isDragging ? 'dragging' : ''}`}>
      <header className="column-header" {...sortable.attributes} {...sortable.listeners}>
        <InlineEdit value={column.title} editing={editing} onEditing={setEditing} onCommit={props.onRename} />
        <span className="count">{tasks.length}</span>
        <button type="button" className="icon-button column-delete" title="Delete column" onClick={props.onDelete}>
          <Trash2 size={14} />
        </button>
      </header>

      <div className="column-cards">
        <SortableContext items={tasks.map((task) => taskDragId(task.id))} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={task.id === props.selectedId}
              onOpen={() => props.onOpenTask(task.id)}
              onToggle={(done) => props.onToggleTask(task.id, done)}
            />
          ))}
        </SortableContext>
      </div>

      {adding ? (
        <form className="column-add" onSubmit={addTask}>
          <input
            autoFocus
            value={newTitle}
            placeholder="Task title, then Enter"
            maxLength={200}
            onChange={(event) => setNewTitle(event.target.value)}
            onBlur={() => newTitle.trim() === '' && setAdding(false)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              setNewTitle('')
              setAdding(false)
            }}
          />
        </form>
      ) : (
        <button type="button" className="ghost-button column-add-button" onClick={() => setAdding(true)}>
          <Plus size={14} />
          Add task
        </button>
      )}
    </section>
  )
}

export function BoardView({ item, version, focusTask, onUpdateItem, onDeleted }: ViewProps) {
  const [columns, setColumns] = useState<Column[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [newColumnId, setNewColumnId] = useState<number | null>(null)
  const { update, remove } = useTaskActions(setTasks, onDeleted)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const reload = useCallback(async () => {
    const data = await api.getBoard(item.id)
    setColumns(data.columns)
    setTasks(data.tasks)
  }, [item.id])

  useEffect(() => {
    reload()
  }, [reload, version])

  useEffect(() => {
    if (focusTask) setSelectedId(focusTask.taskId)
  }, [focusTask])
  useScrollToSelected(selectedId, tasks.length > 0)

  const tasksOf = (columnId: number): Task[] => tasks.filter((task) => task.columnId === columnId)
  const selected = tasks.find((task) => task.id === selectedId && columns.some((column) => column.id === task.columnId))
  const dragTask = dragId !== null && !isColumn(dragId) ? tasks.find((task) => task.id === idOf(dragId)) : undefined
  const dragColumn = dragId !== null && isColumn(dragId) ? columns.find((column) => column.id === idOf(dragId)) : undefined

  const onDragStart = ({ active }: DragStartEvent): void => setDragId(String(active.id))

  // While dragging, a task that enters another column is moved there right away
  // so the cards in that column make room for it.
  const onDragOver = ({ active, over }: DragOverEvent): void => {
    if (!over || isColumn(active.id)) return
    const task = tasks.find((entry) => entry.id === idOf(active.id))
    if (!task) return
    if (isColumn(over.id)) {
      if (task.columnId !== idOf(over.id)) setTasks(placeTask(tasks, task.id, idOf(over.id), tasks.length))
      return
    }
    const overTask = tasks.find((entry) => entry.id === idOf(over.id))
    if (!overTask || overTask.columnId === null || overTask.columnId === task.columnId) return
    const moved = active.rect.current.translated
    const below = moved !== null && moved.top > over.rect.top + over.rect.height / 2
    const index = tasksOf(overTask.columnId).indexOf(overTask) + (below ? 1 : 0)
    setTasks(placeTask(tasks, task.id, overTask.columnId, index))
  }

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    setDragId(null)
    if (isColumn(active.id)) {
      if (!over || active.id === over.id) return
      const ids = columns.map((column) => column.id)
      const order = moveId(ids, idOf(active.id), ids.indexOf(idOf(over.id)))
      setColumns(order.map((id) => columns.find((column) => column.id === id) as Column))
      api.setColumnOrder(item.id, order)
      return
    }
    const task = tasks.find((entry) => entry.id === idOf(active.id))
    if (!task || task.columnId === null) return
    let next = tasks
    if (over && !isColumn(over.id) && over.id !== active.id) {
      const overTask = tasks.find((entry) => entry.id === idOf(over.id))
      if (overTask && overTask.columnId === task.columnId) {
        next = placeTask(tasks, task.id, task.columnId, tasksOf(task.columnId).indexOf(overTask))
        setTasks(next)
      }
    }
    // The column of the task may have changed while dragging, so always save.
    const order = next.filter((entry) => entry.columnId === task.columnId).map((entry) => entry.id)
    api.setTaskOrder(item.id, task.columnId, order)
  }

  const onDragCancel = (): void => {
    setDragId(null)
    reload()
  }

  const addTask = async (columnId: number, title: string): Promise<void> => {
    const task = await api.createTask(item.id, columnId, title)
    setTasks((current) => [...current, task])
  }

  const addColumn = async (): Promise<void> => {
    const column = await api.createColumn(item.id, 'New column')
    setColumns((current) => [...current, column])
    setNewColumnId(column.id)
  }

  const renameColumn = (id: number, title: string): void => {
    setColumns((current) => current.map((column) => (column.id === id ? { ...column, title } : column)))
    api.renameColumn(id, title)
  }

  const deleteColumn = async (column: Column): Promise<void> => {
    await api.deleteColumn(column.id)
    setColumns((current) => current.filter((other) => other.id !== column.id))
    onDeleted({ kind: 'column', id: column.id, title: column.title })
  }

  return (
    <div className="view-with-panel">
      <div className="view">
        <ViewHeader item={item} onUpdateItem={onUpdateItem} />
        <div className="view-body board-body">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <SortableContext items={columns.map((column) => columnDragId(column.id))} strategy={horizontalListSortingStrategy}>
              {columns.map((column) => (
                <BoardColumn
                  key={column.id}
                  column={column}
                  tasks={tasksOf(column.id)}
                  startEditing={column.id === newColumnId}
                  selectedId={selectedId}
                  onOpenTask={setSelectedId}
                  onToggleTask={(id, done) => update(id, { done })}
                  onAddTask={(title) => addTask(column.id, title)}
                  onRename={(title) => renameColumn(column.id, title)}
                  onDelete={() => deleteColumn(column)}
                />
              ))}
            </SortableContext>
            <DragOverlay>
              {dragTask && (
                <div className="card overlay">
                  <CardContent task={dragTask} onToggle={() => {}} />
                </div>
              )}
              {dragColumn && (
                <section className="column overlay">
                  <header className="column-header">
                    <span className="inline-text">{dragColumn.title}</span>
                    <span className="count">{tasksOf(dragColumn.id).length}</span>
                  </header>
                  <div className="column-cards">
                    {tasksOf(dragColumn.id).map((task) => (
                      <div key={task.id} className={`card ${task.done ? 'done' : ''}`}>
                        <CardContent task={task} onToggle={() => {}} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </DragOverlay>
          </DndContext>

          <button type="button" className="ghost-button add-column" onClick={addColumn}>
            <Plus size={14} />
            Add column
          </button>
        </div>
      </div>

      {selected && (
        <TaskPanel
          task={selected}
          onChange={(patch) => update(selected.id, patch)}
          onDelete={() => remove(selected)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}
