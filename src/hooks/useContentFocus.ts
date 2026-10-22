import { createContext, useContext } from 'react'
import { useTabInstance } from '@/context/WorkspaceContext'

/** `'inactive'` means the page is in a workspace tab the user isn't looking at. */
export type FocusZone = 'content' | 'sidebar' | 'inactive'

export const LayoutZoneContext = createContext<FocusZone>('content')

/** Pages read this to know whether they currently own keyboard input — not while the
 * sidebar has arrow-key focus, and not while their tab is hidden behind another one —
 * so they can suspend their hotkeys and row navigation otherwise. */
export function useContentFocus(): { zone: FocusZone } {
  const zone = useContext(LayoutZoneContext)
  const { active } = useTabInstance()
  return { zone: active ? zone : 'inactive' }
}
