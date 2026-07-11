# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm run dev        # start Vite dev server on port 5173
npm run build      # tsc -b (project references) then vite build
npm run lint       # eslint .
npm run preview    # preview production build
npm run kill-port  # kill whatever is holding port 5173 (Windows/PowerShell)
```

There is no test runner configured in this project (no test script, no test files).

## Architecture

This is the frontend for Norbiz, a multi-tenant business management app. It's a Vite + React 19 + TypeScript SPA with no state-management library or server-cache library (no Redux/Zustand/React Query) — all server data is fetched ad hoc with `useEffect` + local component state.

The frontend should deliver a user experience inspired by ERP systems like Quickbooks. All forms should be fully be utilized by keyboard. Apply great emphasis on using keyboard smartly. Plan the breadcrumbs strategically. 

### Backend integration

The backend is a separate Spring Boot API (not in this repo) reached via `VITE_API_BASE` (`.env`, currently `http://localhost:8080`). All calls go through `src/lib/api.ts`:

Frontend can scan http://localhost:8080/swagger-ui for the API specifications

- `apiFetch<T>(url, options)` — JSON fetch wrapper. Adds `Authorization: Bearer <token>` from `localStorage.auth_token`, a CSRF header (`X-XSRF-TOKEN`, read from the `XSRF-TOKEN` cookie) on mutating methods, and `X-Company-Id` from `localStorage.active_company_id`. Throws on non-2xx; returns parsed JSON or `undefined` for empty bodies.
- `apiUpload<T>(url, file, fieldName)` — same auth/CSRF/company headers but posts `FormData` (no `Content-Type`, browser sets the multipart boundary).

Every request is implicitly scoped to the active company via `X-Company-Id`, so any new API call automatically operates on whatever company the user has selected — don't add manual company filtering client-side.

### Auth and multi-tenancy (`src/context/AuthContext.tsx`)

- JWT is stored in `localStorage` (`auth_token`); `active_company_id` is stored separately, since one login can belong to multiple companies. 
- On mount/token-change, `AuthProvider` calls `GET /auth/me` to populate `roles`, `permissions`, and the user's `companies`. It auto-selects the company if there's only one, and clears the stored `active_company_id` if it's no longer valid for the user.
- Permission checks are done with `hasPermission(...perms)` (OR semantics — true if the user has *any* of the listed permissions), backed by the `permissions` string array from `/auth/me`. `MANAGE_SYSTEM` denotes a super-admin (platform-level user, not scoped to a single company) and unlocks cross-company UI (e.g. company checkboxes instead of an implicit single company).
- Routes are gated in `src/App.tsx` via `<ProtectedRoute requiredPermissions={[...]}>` wrapping each page `<Route>`; `ProtectedRoute` (`src/components/ProtectedRoute.tsx`) redirects to `/login` if unauthenticated or to `/dashboard` if the permission check fails. Sidebar nav items (`src/components/AppLayout.tsx`) are filtered by the same permission strings so nav and routing stay consistent — when adding a page, gate both.
- Users that belong to more than one Company should see the Company column or fields throughout the application otherwise those should be hidden
- For all transactions, a Company dropdown is required and must show when a user belongs to multiple companies to indicate which Company the transaction will belong. If user belongs to one company, the  `active_company_id` will automatically be set and and no company dropdown field will show. Apply this also to Master data forms.
- Always have the Company field or column show in all forms. Show it at the topmost and leftmost section of all forms.

### Company field/column placement (implementation)

- `useAuth()` exposes `showCompanyColumn: boolean` (`companies.length > 1 || hasPermission('MANAGE_SYSTEM')`) — the single source of truth for "does this session span more than one Company." Every page with a company-scoped entity reads this instead of re-deriving it.
- **List pages**: the Company column is always the **first** entry in that page's `buildColumns(showCompanyColumn, ...)` array (and the corresponding `<th>`/`<td>` are always the first conditionally-rendered cell in the `<thead>`/`<tbody>` JSX, matching array order) — gated by `showCompanyColumn` so it's hidden entirely in a single-company session, per the redundant-in-a-list reasoning above. `UsersPage`'s pluralized `Companies` column follows the same placement rule for consistency, even though its semantics differ (which companies a *user* belongs to, not which company owns the row).
- **Forms** (the create/view/edit `Dialog` every master-data/transaction page shares): use the shared `src/components/CompanyField.tsx` component, always rendered as the very first field in the form — never conditionally hidden, unlike the list column. It self-selects its own mode:
  - `readOnly` (plain text display of the record's own `companyName`) in view mode, in edit mode (company isn't reassignable after creation), and in create mode when `!showCompanyColumn` (nothing to choose — displays `activeCompany?.name`).
  - Interactive `<select>` only in create mode when `showCompanyColumn` — required, populated from `useAuth().companies` for normal multi-company users, or a fetched `/companies` list for `SUPER_ADMIN` (who may belong to zero companies directly).
  - Takes `autoFocus` — pass `true` only when the field is interactive; the field that used to be first in the form gets `autoFocus={!(mode === 'create' && showCompanyColumn)}` instead, so keyboard entry always lands somewhere useful.
- On submit, create payloads send the form's own `companyId` state (seeded from `activeCompanyId` when the dialog opens, but editable via `CompanyField` when interactive) — never a bare `activeCompanyId!`, since that would silently use the session's active company even when editing a record that belongs to a different one.

### Page pattern

Pages under `src/pages/` (e.g. `UsersPage.tsx`) follow a consistent CRUD shape worth reusing rather than reinventing:
- Local state for the list, plus `open`/`mode` (`'view' | 'create' | 'edit'`)/`activeItem` for a single shared `Dialog` that handles view, create, and edit through one form (fields become read-only in `'view'` mode instead of using a separate detail view).
- List rendered as a plain `<table>` inside `Card`/`CardContent`, row click opens view mode, action buttons (`Eye`/`Pencil`/`Trash2` from `lucide-react`) are gated per-row by `hasPermission('CREATE_X' | 'UPDATE_X' | 'DELETE_X')`.
- Errors from `apiFetch` are caught and surfaced via `useToast()` (`src/context/ToastContext.tsx`), not thrown further.
- Delete uses a plain `window.confirm` before calling the API.

### UI components

`src/components/ui/` holds shadcn/ui-style primitives (Button, Card, Dialog, Input, Label, Toast) built on Radix primitives + `class-variance-authority`, styled with Tailwind v4 (via `@tailwindcss/vite`, no `tailwind.config.js` — theme tokens are CSS custom properties like `--primary`, `--border` referenced as `hsl(var(--border))`). `Button` supports a `loading` prop that disables the button and shows a spinner — use it for async submit buttons instead of hand-rolling disabled/spinner logic. Merge conditional class names with `cn()` from `src/lib/utils.ts` (`clsx` + `tailwind-merge`), not manual string concatenation.

### Routing

`src/App.tsx` is the single source of truth for routes: `BrowserRouter` → `AuthProvider` → `ToastContextProvider` → `AppRoutes`. Authenticated layout routes are nested under one `<ProtectedRoute><AppLayout /></ProtectedRoute>` parent with `<Outlet />`; add new authenticated pages as children of that route plus a per-route `<ProtectedRoute requiredPermissions={[...]}>` wrapper if the page needs a specific permission.

### Path alias

`@/*` maps to `src/*` (configured in both `vite.config.ts` and `tsconfig.app.json`) — always import via `@/...`, not relative paths across directories.

### List Pages
Pages that lists records should be navigable by the up and down button for selection
Columns should be customizable. User can hide or show columns and set as his/her preference
There should be a search box for every page called the Global Filter. The search box searches all data even the user-hidden one. The Global Filter will search only at the frontend side
The Column filters will query the backend for partial matching
Date columns should be filterable by range. Add a utility for commonly used date ranges: Today, Current Week, Current Month, Last 30 Days, Last 3 Months, Current Year
All lists should be by default paginated. Have 50 record per page as default. This should be supported by the backend
All list and report pages should be exportable to a spreadsheet. The columns exported should be based on the visible columns
Boolean columns should be filterable by True, False or non filtered

### Formatting
Currencies are all in Philippine peso by default. Follow the ,0.00 patern. Don't include the Peso sign
Dates should be in a YYYY-MM-DD format

### Document Templates & Printing
A user-designed, freely-positioned document layout, rendered two ways from one component. See the backend `CLAUDE.md`'s "Document Templates & Printing" section for the entity/permission/layout-JSON shape shared between the two repos (the backend stores `layout` as an opaque JSON string — it never inspects or validates it; this repo owns the shape entirely).

- `src/lib/documentTemplate.ts` — the `TemplateLayout`/`TemplateElement` types plus `resolveField(data, path)`, a dotted-path resolver used to bind element data at print time.
- `src/components/TemplateRenderer.tsx` — the **one** renderer shared by both the designer (`mode="edit"`, each element wrapped in a draggable/resizable `react-rnd` `<Rnd>`) and the print view (`mode="print"`, read-only, real `data` substituted in). Never fork this into two renderers — positioning/binding logic would drift between designing and printing.
- `src/pages/DocumentTemplatesPage.tsx` — the standard list-page CRUD pattern (see "Page pattern" above), plus an "Open Designer" action (button + row action) navigating to `/document-templates/:id/design`. Its local `DOCUMENT_TYPES` array must be kept manually in sync with the backend's `DocumentSchemaRegistry` — there is no shared source of truth between the two repos; add an entry here whenever a new backend document type is registered.
- `src/pages/DocumentTemplateDesignerPage.tsx` — a full-screen designer (not a `Dialog`): field/shape palette → canvas (`TemplateRenderer` in edit mode) → properties panel for the selected element. It has **no entry in `src/lib/nav.ts`** — it's reached only via the "Open Designer" action on `DocumentTemplatesPage`, not the sidebar — but is still added as an explicit sibling `<Route path="/document-templates/:id/design">` in `App.tsx`, inside the same `<AppLayout>`-wrapped parent `<Route>` as every `navItems`-driven page, with its own `<ProtectedRoute requiredPermissions={['MANAGE_DOCUMENT_TEMPLATES']}>` wrapper. Use this pattern for any future page that needs auth/layout but shouldn't appear in the sidebar (e.g. a detail/sub-page reached only by drilling in from a list).

**Adding a Print button to a new page** (see `InventoryAdjustmentsPage.tsx` for the reference implementation):
1. `const { print, printPortal } = useDocumentPrint()` (`src/hooks/useDocumentPrint.tsx`).
2. Gate the button on `hasPermission('MANAGE_DOCUMENT_TEMPLATES')`.
3. On click: `await print(record.companyId, '<DOCUMENT_TYPE>', record as unknown as Record<string, unknown>)` — the record's own response object *is* the printable data, so binding paths configured in the designer must match that response's field names exactly.
4. Wrap the call in try/catch: it throws when no default template is configured for **the record's own `companyId`**, not necessarily whichever company is currently active in the session (a template created while Company A was active only ever prints Company A's records) — surface a toast that names that company explicitly, so the user knows which company to switch to before creating one.
5. Render `{printPortal}` once, anywhere in the page's JSX — it's an off-screen portal (`#document-print-root` in `src/index.css`, made visible only inside `@media print`), so its placement in the tree doesn't affect layout.

**Required Vite config**: `vite.config.ts` has `define: { 'process.env': {} }` — required because `react-rnd`'s bundled `react-draggable` references the Node-only `process` global. Without the shim, the app throws an uncaught `ReferenceError` (blanking the whole app — no error boundary catches it) the instant the first draggable element mounts. Do not remove it.

### General Navigation
