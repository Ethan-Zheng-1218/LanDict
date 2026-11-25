import type { LucideIcon, LucideProps } from "lucide-react"
import {
  ArrowDownAZ as SortAlpha, ArrowLeft as Back, ArrowRight as Forward, BookOpen as Book, Check as CheckIcon,
  ChevronDown as Down, ChevronRight as Right, Copy as CopyIcon, Eraser as EraserIcon,
  Heart as HeartIcon, History as HistoryIcon, House, Info as InfoIcon, Languages as Translate,
  Minus, Palette as PaletteIcon, PanelLeft, PanelRightOpen as PanelRight, Pause as PauseIcon,
  Play as PlayIcon, Search as SearchIcon, Settings as SettingsIcon, SlidersHorizontal as Sliders,
  Sparkles as SparklesIcon, Square, Star as StarIcon, StickyNote as Note,
  Trash2 as Trash, Type as FontSize, Volume2 as Speaker, X as Close,
  Bookmark as BookmarkIcon, Download as DownloadIcon, Upload as UploadIcon, Eye as EyeIcon, EyeOff as EyeOffIcon,
  GraduationCap as GraduateIcon, ListFilter as FilterIcon,
} from "lucide-react"

export type IconProps = LucideProps

// One geometry and stroke contract for all pages; callers retain the old API.
function icon(Component: LucideIcon) {
  return function Icon({ size = 20, strokeWidth = 1.8, ...props }: IconProps) {
    return <Component aria-hidden="true" size={size} strokeWidth={strokeWidth} {...props} />
  }
}
export const Home = icon(House)
export const ArrowLeft = icon(Back)
export const ArrowRight = icon(Forward)
export const ArrowDownAZ = icon(SortAlpha)
export const BookOpen = icon(Book)
export const Bookmark = icon(BookmarkIcon)
export const Check = icon(CheckIcon)
export const ChevronDown = icon(Down)
export const ChevronRight = icon(Right)
export const Copy = icon(CopyIcon)
export const Download = icon(DownloadIcon)
export const Upload = icon(UploadIcon)
export const Eraser = icon(EraserIcon)
export const Eye = icon(EyeIcon)
export const EyeOff = icon(EyeOffIcon)
export const Heart = icon(HeartIcon)
export const History = icon(HistoryIcon)
export const Graduate = icon(GraduateIcon)
export const Info = icon(InfoIcon)
export const Languages = icon(Translate)
export const ListFilter = icon(FilterIcon)
export const Palette = icon(PaletteIcon)
export const PanelLeftIcon = icon(PanelLeft)
export const PanelRightOpen = icon(PanelRight)
export const Pause = icon(PauseIcon)
export const Play = icon(PlayIcon)
export const Search = icon(SearchIcon)
export const Settings = icon(SettingsIcon)
export const Settings2 = Settings
export const SlidersHorizontal = icon(Sliders)
export const Sparkles = icon(SparklesIcon)
export const Star = icon(StarIcon)
export const StickyNote = icon(Note)
export const Trash2 = icon(Trash)
export const Type = icon(FontSize)
export const Volume2 = icon(Speaker)
export const WindowMinimize = icon(Minus)
export const WindowMaximize = icon(Square)
export const WindowClose = icon(Close)
export const X = icon(Close)
export const XIcon = X
