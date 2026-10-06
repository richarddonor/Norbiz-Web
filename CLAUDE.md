# CLAUDE.md

Guidance for Claude Code in this repo. It covers only what's cross-cutting. Detailed specs live in `docs/`. They are referenced here, not imported, so read one only when a task touches its area:

- `docs/RECORD_PAGES.md`: the CRUD page pattern, which covers record tabs (`useRecordTab`/`RecordSheet`), the dirty guard, submit/delete confirms, the Add Line shortcut, transaction actions & history, master-data change history, and display names.
- `docs/DOC_FORM.md`: paper-form layout (`DocSheet`/`DocRow`/`DocCell`/`DocLines`…), document field order, placeholders.
- `docs/MULTI_COMPANY.md`: Company column/`CompanyField` placement and modes.
- `docs/DROPDOWNS.md`: `SearchableSelect` contract and keyboard/focus model, `useLookup` (`/lookups/*`), stock guide columns (`useStock`/`StockCell`).
- `docs/LIST_PAGES.md`: list-page requirements (Global Filter, column filters, date ranges, export, Reload).
- `docs/DOCUMENT_TEMPLATES.md`: template designer, `TemplateRenderer`, adding a Print button.

Backend specs are in `../Norbiz/docs/` (e.g. `LIST_FILTERING.md`, `TRANSACTION_ACTIONS.md`, `AUDIT.md`, `DOCUMENT_TEMPLATES.md`).

## Commands

```
npm run dev        # Vite dev server on port 5173
npm run build      # tsc -b then vite build
npm run lint       # eslint .
npm run preview    # preview production build
npm run kill-port  # free port 5173 (Windows/PowerShell)
```

No test runner is configured.

## Architecture

Frontend for Norbiz, a multi-tenant ERP. It's a Vite + React 19 + TypeScript SPA. There's no state or server-cache library: data is fetched with `useEffect` + local state. The UX is Quickbooks-inspired. Every form must be fully keyboard-driven, so put real thought into keyboard flow and breadcrumbs.

- **API**: all calls go through `src/lib/api.ts`. `apiFetch<T>` and `apiUpload<T>` add the Bearer token (`localStorage.auth_token`), CSRF (`X-XSRF-TOKEN`) on mutations, and `X-Company-Id` (`localStorage.active_company_id`). They throw `ApiError` (`status`, `code`, `details`, `traceId`). Requests are scoped to the active company server-side, so never filter by company client-side. `VITE_API_BASE` is `http://localhost:8080`, and the API spec is at `/swagger-ui`. If the backend isn't reachable, check `docker compose ps` in `../Norbiz` (its `docker-compose.yml` has the port mappings). Failing that, read the DTOs in `../Norbiz/src/main/java/.../dto/`.
- **Auth** (`src/context/AuthContext.tsx`): `GET /auth/me` loads `roles`, `permissions` and `companies`. `hasPermission(...perms)` has OR semantics. `MANAGE_SYSTEM` means super-admin (cross-company). Gate every page in both places: the route (`navItems.permission` → `ProtectedRoute`) and the sidebar nav.
- **Multi-company**: `useAuth().showCompanyColumn` (`companies.length > 1 || MANAGE_SYSTEM`) is the single source of truth. When it's true, the Company column is the first list column and `CompanyField` is the first form field (top-left, via `DocLetterhead`). When it's false, both are hidden and the form uses `activeCompanyId`. Create payloads send the form's own `companyId` state, never a bare `activeCompanyId!`. Details are in `docs/MULTI_COMPANY.md`.
- **Routing**: `src/App.tsx` is the top level. Authenticated pages are in `PageRoutes` (`src/routes.tsx`), which renders once per open workspace tab. To add a page, add it to `pageComponents` and `navItems` (`src/lib/nav.ts`). A `recordLabel` on its nav entry enables record tabs.
- **Reports nav**: the sidebar's Reports group shows one link per category (`reportCategories` in `nav.ts`), and each category page (`ReportCategoryPage`) lists the reports the user can open. Add a report to the `reports` array in `nav.ts`, with its `parent` category and a `description`, and add it to `routes.tsx`. Category pages sort reports alphabetically by label, so their order in `nav.ts` doesn't matter. A report opened from its category page or the command palette gets its own workspace tab (`useWorkspace().openPage`, keyed by its path). The palette opens every page this way, not just reports. Reaching a page any other way, e.g. the sidebar, shows it in the main tab, unless its tab is already open. A drill-down from another report (`openPage` with a query) opens a further tab of that report, keyed by its full URL, and the page locks its filters there (`useIsDrillDown()`), so one report can have one unfiltered tab plus any number of drill-down tabs. A category's permission is the union of its reports' permissions, so a category with no permitted reports is hidden, and Reports itself is hidden when no category shows.
- **Path alias**: always import via `@/…` (maps to `src/*`).

## Must-follow rules

- **Records open in workspace tabs**, not modals. Follow `docs/RECORD_PAGES.md` when building or changing a record page.
- **Forms use the paper-form layout** from `src/components/ui/doc-form.tsx` (`docs/DOC_FORM.md`). Never put `overflow-hidden` on `DocSheet`. Don't use example or "Optional" placeholders.
- **Never use a native `<select>`.** Use `SearchableSelect`. It has no HTML `required`, so validate in `handleSubmit`. Dropdown data comes from `useLookup` (`/lookups/*`), never from full list endpoints. Keep the two `requestAnimationFrame` focus deferrals in `SearchableSelect` (`docs/DROPDOWNS.md`).
- **Confirms**: `window.confirm` before every create/save/post/delete/void. Delete errors go through `deleteErrorMessage(err, …)`. Close paths go through `useDirtyGuard`. API errors are toasted with `useToast()`, not rethrown.
- **Show Display Names, never usernames**, for `createdBy`/`updatedBy`/`voidedBy` (`useUserDisplayNames`), including in exports.
- **List pages**: paginate at 50 per page, with arrow-key row navigation, a Columns menu, Global Filter, backend column filters, date-range filters, an export covering all filtered rows, and Reload. Details are in `docs/LIST_PAGES.md`.
- **UI primitives**: `src/components/ui/` (shadcn-style, Radix + CVA, Tailwind v4 with tokens as CSS vars, no tailwind config). Use `Button`'s `loading` prop and `cn()` for class merging.
- **Formatting**: currency is PHP shown as `#,##0.00` with no peso sign (`formatCurrency` in `src/lib/format.ts`). Dates are `YYYY-MM-DD`.
- **Hand-synced enums**: `TRANSACTION_TYPES` (`useTransactionActivity.ts`), `TRANSACTION_PATHS` (`useTransactionDrillDown.ts`, which report rows use to open their transaction), `MasterDataType` (`ChangeHistory.tsx`) and `DOCUMENT_TYPES` (`DocumentTemplatesPage.tsx`) mirror backend enums. Update them when the backend adds a type.
- **Detailed reports**: every transaction type has a `<Transaction> - Detailed` report (one row per line item) gated by its own `VIEW_<TYPE>_DETAILED_REPORT` permission. They're all one component configured in `src/pages/TransactionDetailedReportPages.tsx`. A new transaction type needs a config there, plus a `reports` entry in `nav.ts` and a `routes.tsx` entry (see `../Norbiz/docs/TRANSACTIONS.md` → Detailed reports).
- **Never remove** `define: { 'process.env': {} }` from `vite.config.ts`. `react-rnd` needs it, and without it the app blanks.
