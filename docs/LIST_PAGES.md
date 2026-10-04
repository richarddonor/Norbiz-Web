# List pages

- Pages that lists records should be navigable by the up and down button for selection
- Columns should be customizable. User can hide or show columns and set as his/her preference
- There should be a search box for every page called the Global Filter. The search box searches all data even the user-hidden one. The Global Filter will search only at the frontend side
- The Column filters will query the backend for partial matching
- Date columns should be filterable by range. Add a utility for commonly used date ranges: Today, Current Week, Current Month, Last 30 Days, Last 3 Months, Current Year
- All lists should be by default paginated. Have 50 record per page as default. This should be supported by the backend
- All list and report pages should be exportable to a spreadsheet. The columns exported should be based on the visible columns. Export covers **all rows matching the current column filters across every page**, not just the page on screen — export handlers call `fetchAllContent(endpoint + filters)`, which pages through the backend (capped at 1000 rows per request) until the last page.
- Boolean columns should be filterable by True, False or non filtered
- All list and report pages have a **Reload** button (`src/components/ReloadButton.tsx`, placed just before `ColumnsMenu`, hotkey `R`) that calls `usePagedList`'s `reload()` — it re-queries the backend with the current page and column filters (the defaults if untouched), never resetting them. Pass the hook's `loading` (aliased `listLoading`, since pages already use `loading` for submit state) so the icon spins while the request runs.
