import { CircleCheck, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Item, SearchResult } from '../../shared/types'
import { api } from './api'
import { ItemIcon, TYPE_LABEL } from './icons'
import { Highlight } from './ui'

// Search over everything, opened with Ctrl+K. Arrow keys move, Enter opens, Escape closes.
export function SearchDialog(props: { items: Item[]; onOpen: (result: SearchResult) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let stale = false
    api.search(query).then((found) => {
      if (stale) return
      setResults(found)
      setActive(0)
    })
    return () => {
      stale = true
    }
  }, [query])

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    event.stopPropagation()
    if (event.key === 'Escape') props.onClose()
    else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && results[active]) {
      props.onOpen(results[active])
    }
  }

  return (
    <div className="overlay-backdrop" onMouseDown={props.onClose}>
      <div className="search-dialog" role="dialog" aria-label="Search" onMouseDown={(event) => event.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="search-input">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder="Search entries, tasks and notes"
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </div>

        {results.length > 0 && (
          <ul className="search-results" ref={listRef}>
            {results.map((result, index) => (
              <li
                key={`${result.kind}-${result.taskId ?? result.itemId}`}
                className={index === active ? 'active' : ''}
                onMouseMove={() => setActive(index)}
                onClick={() => props.onOpen(result)}
              >
                {result.kind === 'task' ? (
                  <CircleCheck size={16} className="item-icon muted" />
                ) : (
                  <ItemIcon item={props.items.find((item) => item.id === result.itemId) ?? { type: result.itemType, icon: '', color: '' }} />
                )}
                <div className="search-text">
                  <div className="search-title">
                    <span className="search-name">
                      <Highlight text={result.title} query={query} />
                    </span>
                    <span className="search-context">
                      {result.kind === 'task' ? `Task in ${result.itemTitle}` : TYPE_LABEL[result.itemType]}
                    </span>
                  </div>
                  {result.snippet && (
                    <div className="search-snippet">
                      {result.snippet.before}
                      <mark>{result.snippet.match}</mark>
                      {result.snippet.after}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {results.length === 0 && (
          <div className="search-empty">{query.trim() === '' ? 'Type to search. Use ↑ ↓ and Enter.' : 'Nothing found.'}</div>
        )}
      </div>
    </div>
  )
}
