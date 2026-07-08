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

### Formatting
Currencies are all in Philippine peso by default. Follow the ,0.00 patern. Don't include the Peso sign
Dates should be in a YYYY-MM-DD format


### General Navigation
