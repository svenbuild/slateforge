import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { moveId, reorderSubset, sortTasks } from '../../shared/logic'
import type { SortMode, Task } from '../../shared/types'
import { api } from './api'
import { listBody } from './export'
import { TaskPanel } from './TaskPanel'
import { Checkbox, TaskMeta, ViewHeader, useScrollToSelected, useTaskActions, type ViewProps } from './ui'

interface RowProps {
  task: Task
  selected: boolean
  onOpen: () => void
  onToggle: (done: boolean) => void
}

function RowContent({ task, onToggle }: RowProps) {
  return (
    <>
      <Checkbox checked={task.done} onChange={onToggle} label={`Done: ${task.title}`} />
      <span className="task-title">{task.title}</span>
      <TaskMeta task={task} />
    </>
  )
}

// Row of an open task. It can be dragged while the list is sorted manually.
function OpenRow(props: RowProps & { draggable: boolean }) {
  const sortable = useSortable({ id: props.task.id })
  const style = {
    transform: CSS.Translate.toString(sortable.transform && { ...sortable.transform, x: 0 }),
    transition: sortable.transition
  }
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={`task-row ${props.selected ? 'selected' : ''} ${sortable.isDragging ? 'dragging' : ''}`}
      onClick={props.onOpen}
      {...sortable.attributes}
      {...(props.draggable ? sortable.listeners : {})}
    >
      <RowContent {...props} />
    </li>
  )
}

function DoneRow(props: RowProps) {
  return (
    <li className={`task-row done ${props.selected ? 'selected' : ''}`} onClick={props.onOpen}>
      <RowContent {...props} />
    </li>
  )
}

export function ListView({ item, version, focusTask, onUpdateItem, onDeleted, onTasksChanged }: ViewProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showDone, setShowDone] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const { update, remove } = useTaskActions(setTasks, onDeleted, onTasksChanged)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    let stale = false
    api.listTasks(item.id).then((loaded) => !stale && setTasks(loaded))
    return () => {
      stale = true
    }
  }, [item.id, version])

  useEffect(() => {
    if (focusTask) setSelectedId(focusTask.taskId)
  }, [focusTask])
  useScrollToSelected(selectedId, tasks.length > 0)

  const open = sortTasks(
    tasks.filter((task) => !task.done),
    item.sortMode
  )
  const done = tasks.filter((task) => task.done)
  const selected = tasks.find((task) => task.id === selectedId)

  const addTask = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const title = newTitle.trim()
    if (title === '') return
    setNewTitle('')
    const task = await api.createTask(item.id, null, title)
    setTasks((current) => [...current, task])
    onTasksChanged()
  }

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return
    const openIds = open.map((task) => task.id)
    const newOpenIds = moveId(openIds, Number(active.id), openIds.indexOf(Number(over.id)))
    const order = reorderSubset(
      tasks.map((task) => task.id),
      newOpenIds
    )
    setTasks(order.map((id) => tasks.find((task) => task.id === id) as Task))
    api.setTaskOrder(item.id, null, order)
  }

  const rowProps = (task: Task): RowProps => ({
    task,
    selected: task.id === selectedId,
    onOpen: () => setSelectedId(task.id),
    onToggle: (isDone) => update(task.id, { done: isDone })
  })

  return (
    <div className="view-with-panel">
      <div className="view">
        <ViewHeader item={item} onUpdateItem={onUpdateItem} exportBody={() => listBody(item.title, open, done)}>
          <label className="sort-select">
            Sort
            <select value={item.sortMode} onChange={(event) => onUpdateItem({ sortMode: event.target.value as SortMode })}>
              <option value="manual">Manual</option>
              <option value="due">Due date</option>
              <option value="priority">Priority</option>
            </select>
          </label>
        </ViewHeader>

        <div className="view-body list-body">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={open.map((task) => task.id)} strategy={verticalListSortingStrategy}>
              <ul className="task-list">
                {open.map((task) => (
                  <OpenRow key={task.id} {...rowProps(task)} draggable={item.sortMode === 'manual'} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <form className="add-task" onSubmit={addTask}>
            <Plus size={16} />
            <input
              value={newTitle}
              placeholder="Add a task and press Enter"
              maxLength={200}
              onChange={(event) => setNewTitle(event.target.value)}
            />
          </form>

          {done.length > 0 && (
            <>
              <button type="button" className="section-toggle" onClick={() => setShowDone(!showDone)}>
                {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Completed
                <span className="count">{done.length}</span>
              </button>
              {showDone && (
                <ul className="task-list">
                  {done.map((task) => (
                    <DoneRow key={task.id} {...rowProps(task)} />
                  ))}
                </ul>
              )}
            </>
          )}
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
