import { createContext, useContext } from 'react'

/** Set by `DocCell` (and each `DocLines` cell) so `Input` / `SearchableSelect` render
 * borderless — the cell's own ruling is the field's box, like a pre-printed paper form. */
export const DocCellContext = createContext(false)

export function useInDocCell() {
  return useContext(DocCellContext)
}
