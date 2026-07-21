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
- **Forms** (create/view/edit dialogs, and the full-screen designer): use the shared `src/components/CompanyField.tsx` component, always rendered as the very first field in the form — never conditionally hidden, unlike the list column. It self-selects its own mode:
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
- Every modal form's `handleSubmit` confirms before calling the API too: `if (!window.confirm(mode === 'create' ? \`Create <entity> "${name}"?\` : \`Save changes to <entity> "${name}"?\`)) return`, placed after existing field validation (so a truly invalid submit still just toasts and returns, no confirm shown) but before `setLoading(true)`. Transaction pages (Purchase Order, Purchase Invoice, Inventory Adjustment — create-only, no name field) use a fixed message instead: `Post this <transaction>? This cannot be edited afterward — only voided.`, naming the immutability consequence rather than an identifier. Matches the existing Delete/Void `window.confirm` convention rather than introducing a new dialog component.
- Closing a modal (Cancel button, the dialog's own X, Escape, click-outside) is guarded by `useDirtyGuard` (`src/hooks/useDirtyGuard.ts`) — it only confirms ("Discard unsaved changes?") when the user actually changed something since the dialog opened, not on every close. Wire it as: call `markClean(snapshot)` at the end of every `open{View,Edit,Create}` function (right after the `setX(...)` calls that seed the form, using those same just-set values — state updates are async, so re-reading the state variables immediately after wouldn't see them yet), define `function requestClose() { guardedClose(snapshot, () => setOpen(false)) }`, then route every close path through it: `<Dialog onOpenChange={v => (v ? setOpen(true) : requestClose())}>` and the Cancel/Close buttons' `onClick={requestClose}` (both, not just Cancel — routing Close through it too is harmless since view mode's fields never change, so it never actually prompts there). `snapshot` is whatever combination of the page's form state is relevant — most pages have one `form` object and can pass it directly or as `{ form, companyId }` when `companyId` is tracked separately (`BrandsPage`/`ItemCategoriesPage` use bare `name`/`companyId` instead of a `form` object — snapshot those directly); transaction pages (no `form` object, many individual `useState` fields) snapshot all of the create-relevant fields as one object. `markClean`/`guardedClose` JSON-diff the snapshot, so pass plain serializable values — a field holding a `Set` (tags, permissions, company assignments) is fine, `Set` gets special-cased into a sorted array before comparing; a field holding a `File` (image upload) doesn't serialize meaningfully, so pass a derived boolean (`hasFile: !!selectedFile`) instead of the `File` object itself. Not applied to `DocumentTemplateDesignerPage` — it's a full-screen page, not a `Dialog`.
- Transaction forms' "Add Line" button (Purchase Order, Purchase Invoice, Inventory Adjustment) has a `Ctrl+Enter` shortcut, shown as a `<kbd>` hint next to the button label — wired via `onKeyDown` on the `<form>` itself (`if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addLine() }`), not `useHotkeys` (that hook is disabled while any dialog is open). Deliberately not plain `Enter` — that's already claimed by `SearchableSelect`'s "confirm field, advance to next" behavior and by native form submit-on-Enter. On `PurchaseInvoicesPage` the handler is additionally gated on `invoiceMode === 'DIRECT'` — PO-based mode's lines mirror the selected PO 1:1 and aren't user-extendable, so the same guard that hides the button there also has to gate the shortcut.
- Always show a user's **Display Name**, never their raw username, anywhere a form/list surfaces who did something. Every `Auditable` entity's `createdBy`/`updatedBy`/`voidedBy` is stamped by the backend's `AuditorAwareImpl` with the username (`Authentication.getName()`), not displayName — username is the correct stable key to persist, but the wrong thing to show. Resolve it client-side with `useUserDisplayNames` (`src/hooks/useUserDisplayNames.ts`): `const resolveDisplayName = useUserDisplayNames()`, then `resolveDisplayName(record.createdBy)` anywhere that field is rendered — detail-view "Created by"/"Posted by"/"Last updated by" rows, list-page columns, and the values handed to `exportToXlsx` (export should show what the visible column shows). It fetches `/users` once (silently no-ops without `VIEW_USER`) and falls back to the raw username whenever it can't resolve one — not yet loaded, deleted account, or the synthetic `"system"` auditor — so it's always safe to call unconditionally. Deliberately **not** applied to `searchText` functions (the blob the Global Filter searches) — that's a separate, unconfirmed scope; those still key off the raw username.

### UI components

`src/components/ui/` holds shadcn/ui-style primitives (Button, Card, Dialog, Input, Label, Toast) built on Radix primitives + `class-variance-authority`, styled with Tailwind v4 (via `@tailwindcss/vite`, no `tailwind.config.js` — theme tokens are CSS custom properties like `--primary`, `--border` referenced as `hsl(var(--border))`). `Button` supports a `loading` prop that disables the button and shows a spinner — use it for async submit buttons instead of hand-rolling disabled/spinner logic. Merge conditional class names with `cn()` from `src/lib/utils.ts` (`clsx` + `tailwind-merge`), not manual string concatenation.

**Dropdowns must be text-searchable.** Never use a plain native `<select>`. Use `SearchableSelect` (`src/components/ui/searchable-select.tsx`) for every dropdown — filter/toolbar selects, form fields, and per-line selects alike, whether the options are master-data records (companies, warehouses, items, ...) or a small fixed enum (status, orientation, alignment, ...). It keeps the same `value`/`onChange` string contract as a native select (callers still do `String(id)` / `Number(value)` conversions the same way), and always injects a blank/placeholder entry first, matching the old `<option value="">…</option>` convention — so a field that must never end up blank (a fixed-enum toggle rather than an optional picker) needs an `onChange={v => setX(v || 'DEFAULT')}` fallback rather than allowing `''` through. It does **not** implement native HTML5 `required` (it isn't a real `<select>`) — any field that relied on `required` for validation needs an explicit check in the form's `handleSubmit` instead (e.g. `if (!warehouseId) { toast('Select a warehouse.', 'error'); return }`), consistent with how `companyId`/lines are already validated on most pages.

**Keyboard model (Quickbooks-style grid entry)**: focusing the trigger and typing opens the dropdown and starts filtering immediately — no separate "open" keypress first, matching native `<select>` typeahead. Enter always confirms and moves focus to the next tabbable field in the same `<form>` (via `focusNextElement`), even on a closed trigger with nothing changed — Enter reads as "confirm this field, move on" everywhere, the same way it does inside a plain `Input`. Keyboard-driven opens deliberately leave DOM focus on the trigger `<button>` itself rather than the nested search `<input>` — only a mouse click on the trigger hands focus to the input. This isn't cosmetic: moving focus into the input via `requestAnimationFrame` while keystrokes are still arriving races React unmounting/remounting the dropdown against Radix's `Dialog` focus-trap, and can strand focus on the dialog's own container element. For the same reason, the post-commit `focusNextElement` call is itself deferred one frame (`requestAnimationFrame`) rather than called synchronously inside the keydown handler — calling it synchronously, before React has flushed the state update that unmounts the dropdown, hits the same trap and silently fails. If you touch this component's focus handling, keep both of those deferrals.

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

**Field-type-driven formatting/alignment**: every bindable field (backend `DocumentSchemaRegistry`) now carries a `type` of `string | number | date | currency | user`, not just the original three. A `text` element (and each `table` column) captures the schema field's `type` as its own `fieldType` when dropped from the palette — persisted in the saved layout JSON, not re-derived at render time. `TemplateRenderer` uses it to match the conventions in the backend `CLAUDE.md`'s Document Templates & Printing section:
  - `currency` → formatted with `formatCurrency` (`src/lib/format.ts`), same as everywhere else in the app.
  - `user` → resolved from the raw stamped username to the person's Display Name via `useUserDisplayNames()`, called once inside `TemplateRenderer` itself (not by callers) so both designer preview and print get it for free.
  - `number`/`currency` → right-aligned by default (`defaultAlign()` in `documentTemplate.ts`); an explicit per-element `style.align` set in the Properties panel always overrides this default.
  - `reconcileFieldTypes(layout, schema)` backfills `fieldType` on elements/columns that predate this (matched by `binding` path against the fetched schema) without touching elements that already have one — so existing hand-built templates (the ones created via `POST /document-templates` before this existed) immediately pick up currency/user formatting without being re-edited. Called both by `DocumentTemplateDesignerPage` on load (result gets persisted on next Save) and by `useDocumentPrint` on every print (since a template someone hasn't opened in the designer since would otherwise never get backfilled).
  - **Alignment guides**: dragging an element in the designer snaps its x/y to any other element's x/y within 4px (`computeSnap` in `TemplateRenderer.tsx`) and shows a thin guide line while snapped — this is the tooling behind "labels aligned vertically with one another": drag a new label near an existing one's x and it snaps into the same column.
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
