import {
  Book,
  Briefcase,
  Bug,
  Calendar,
  Camera,
  Code,
  Coffee,
  Dumbbell,
  FileText,
  Flag,
  Flame,
  Folder,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  House,
  Inbox,
  Leaf,
  Lightbulb,
  ListChecks,
  Music,
  Plane,
  Rocket,
  ShoppingCart,
  SquareKanban,
  Star,
  Target,
  Users,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { Item, ItemType } from '../../shared/types'

export const ICONS: Record<string, LucideIcon> = {
  kanban: SquareKanban,
  checklist: ListChecks,
  note: FileText,
  star: Star,
  heart: Heart,
  home: House,
  work: Briefcase,
  cart: ShoppingCart,
  book: Book,
  idea: Lightbulb,
  rocket: Rocket,
  calendar: Calendar,
  code: Code,
  music: Music,
  camera: Camera,
  travel: Plane,
  folder: Folder,
  flag: Flag,
  target: Target,
  coffee: Coffee,
  sport: Dumbbell,
  study: GraduationCap,
  money: Wallet,
  tools: Wrench,
  nature: Leaf,
  bug: Bug,
  gift: Gift,
  people: Users,
  globe: Globe,
  energy: Zap,
  fire: Flame,
  inbox: Inbox
}

export const COLORS: Record<string, string> = {
  gray: '#8b8d98',
  red: '#e5484d',
  orange: '#f0802b',
  yellow: '#dba42a',
  green: '#30a46c',
  teal: '#12a5a0',
  blue: '#3e8ef7',
  purple: '#8e6ef5',
  pink: '#d6409f'
}

const DEFAULT_ICON: Record<ItemType, string> = { board: 'kanban', list: 'checklist', note: 'note' }
const DEFAULT_COLOR: Record<ItemType, string> = { board: 'blue', list: 'green', note: 'orange' }

export const TYPE_LABEL: Record<ItemType, string> = { board: 'Board', list: 'List', note: 'Note' }

export function iconKey(item: Pick<Item, 'type' | 'icon'>): string {
  return ICONS[item.icon] ? item.icon : DEFAULT_ICON[item.type]
}

export function colorKey(item: Pick<Item, 'type' | 'color'>): string {
  return COLORS[item.color] ? item.color : DEFAULT_COLOR[item.type]
}

export function ItemIcon({ item, size = 16 }: { item: Pick<Item, 'type' | 'icon' | 'color'>; size?: number }) {
  const Icon = ICONS[iconKey(item)]
  return <Icon size={size} color={COLORS[colorKey(item)]} className="item-icon" />
}
