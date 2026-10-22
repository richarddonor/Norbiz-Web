import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Eye, FileDown } from 'lucide-react'
import { apiFetch, deleteErrorMessage, mutationErrorMessage } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DocSheet, DocRow, DocCell, DocHeader, DocCheck, DocSignatures, DocText } from '@/components/ui/doc-form'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useLookup, type LookupOption } from '@/lib/lookups'
import { Card, CardContent } from '@/components/ui/card'
import { ChangeHistory } from '@/components/ChangeHistory'
import { useRecordTab, useIsRecordTab } from '@/hooks/useRecordTab'
import { RecordSheet, RECORD_ACTIONS, CloseButton } from '@/components/RecordTab'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import { useUserDisplayNames } from '@/hooks/useUserDisplayNames'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useContentFocus } from '@/hooks/useContentFocus'
import { usePagedList, fetchAllContent, filtersToQueryString } from '@/hooks/usePagedList'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { useRowGrouping, useGroupedRows } from '@/hooks/useRowGrouping'
import { GroupByMenu } from '@/components/RowGrouping'
import { groupedRows } from '@/components/groupedRows'
import { useListSort } from '@/hooks/useListSort'
import { SortableTh } from '@/components/SortableTh'
import { ColumnsMenu, type ColumnDef } from '@/components/ColumnsMenu'
import { ReloadButton } from '@/components/ReloadButton'
import { GlobalSearch } from '@/components/GlobalSearch'
import { ColumnFilterRow } from '@/components/ColumnFilterRow'
import { CompanyField, DocLetterhead } from '@/components/CompanyField'
import { Pagination } from '@/components/Pagination'
import { ScrollTable } from '@/components/ScrollTable'
import { exportToXlsx } from '@/lib/exportXlsx'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type FormMode = 'view' | 'create' | 'edit'

interface CompanyOption {
  id: number
  name: string
}

interface BankAccount {
  id: number
  companyId: number
  companyName: string
  bankId: number
  bankCode: string
  bankName: string
  accountNumber: string
  name: string
  openingBalance: string
  openingBalanceDate: string | null
  active: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

function buildColumns(showCompanyColumn: boolean): readonly ColumnDef[] {
  const columns: ColumnDef[] = []
  if (showCompanyColumn) columns.push({ key: 'company', label: 'Company', sortable: true })
  columns.push(
    { key: 'name', label: 'Name', sortable: true },
    { key: 'accountNumber', label: 'Account Number', sortable: true },
    { key: 'bank', label: 'Bank', sortable: true },
    { key: 'openingBalance', label: 'Opening Balance' },
    { key: 'active', label: 'Active', sortable: true, type: 'boolean' },
  )
  columns.push(
    { key: 'createdBy', label: 'Created by', sortable: true },
    { key: 'updatedAt', label: 'Last updated', sortable: true, type: 'date' },
  )
  return columns
}

function accountSearchText(r: BankAccount): string {
  return [r.accountNumber, r.name, r.bankName, r.companyName, r.active ? 'active' : 'inactive', r.createdBy ?? '', r.updatedBy ?? ''].join(' ')
}

export function BankAccountsPage() {
  const { toast } = useToast()
  const { hasPermission, activeCompanyId, activeCompany, showCompanyColumn, companies } = useAuth()
  const { zone } = useContentFocus()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const COLUMNS = useMemo(() => buildColumns(showCompanyColumn), [showCompanyColumn])
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  const companyOptions = isSuperAdmin ? allCompanies : companies

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(search)
  const debouncedFilters = useDebouncedValue(filters)
  const isFiltering = !!debouncedSearch.trim() || Object.values(debouncedFilters).some(v => v.trim())

  const inRecordTab = useIsRecordTab()
  const grouping = useRowGrouping(COLUMNS, 'bank-accounts')
  const sorting = useListSort(COLUMNS)
  const { items: accounts, page, setPage, pageSize, setPageSize, totalPages, totalElements, reload, loading: listLoading, searchAll, allRows } = usePagedList<BankAccount>('/bank-accounts', {
    all: grouping.active,
    enabled: !inRecordTab,
    onError: () => toast('Failed to load bank accounts.', 'error'),
    search: debouncedSearch,
    filters: sorting.apply(debouncedFilters),
    searchText: accountSearchText,
  })

  const [mode, setMode]                   = useState<FormMode>('view')
  const rec = useRecordTab<BankAccount>({
    mode,
    onOpen: { view: openView, edit: openEdit, create: openCreate },
    onRequestClose: requestClose,
    fetchRecord: id => apiFetch<BankAccount>(`/bank-accounts/${id}`),
  })
  const [activeAccount, setActiveAccount]   = useState<BankAccount | null>(null)
  const [accountNumber, setAccountNumber]                   = useState('')
  const [bankId, setBankId]               = useState<number | ''>('')
  const [openingBalance, setOpeningBalance] = useState('')
  const [openingBalanceDate, setOpeningBalanceDate] = useState('')
  const [name, setName]                   = useState('')
  const [active, setActive]               = useState(true)
  const [companyId, setCompanyId]         = useState<number | ''>('')
  const [loading, setLoading]             = useState(false)
  const { isVisible, menu: columnMenu } = useColumnVisibility('bank-accounts')
  const bankOptions = useLookup<LookupOption>('banks', companyId || activeCompanyId, { enabled: inRecordTab && mode !== 'view', onError: () => toast('Failed to load banks.', 'error') })
  const resolveDisplayName = useUserDisplayNames()
  const { markClean, guardedClose } = useDirtyGuard()

  const canCreate = hasPermission('CREATE_BANK_ACCOUNT')
  const canUpdate = hasPermission('UPDATE_BANK_ACCOUNT')
  const canDeleteAccount = hasPermission('DELETE_BANK_ACCOUNT')

  const view = useGroupedRows(grouping, accounts, listRow)
  const { activeIndex, setActiveIndex } = useListKeyboardNav({
    items: accounts,
    view,
    onView: openView,
    onEdit: canUpdate ? openEdit : undefined,
    onDelete: canDeleteAccount ? handleDelete : undefined,
    canEdit: canUpdate,
    canDelete: canDeleteAccount,
    enabled: !inRecordTab && zone === 'content',
  })

  useHotkeys([
    { key: 'n', handler: () => canCreate && openCreate() },
    { key: 'r', handler: () => reload() },
  ], !inRecordTab && zone === 'content')

  useEffect(() => {
    if (isSuperAdmin) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
  }, [])

  function openView(account: BankAccount) {
    if (!rec.isRecordTab) return rec.open('view', account)
    setActiveAccount(account)
    setAccountNumber(account.accountNumber)
    setBankId(account.bankId)
    setOpeningBalance(String(account.openingBalance ?? ''))
    setOpeningBalanceDate(account.openingBalanceDate?.slice(0, 10) ?? '')
    setName(account.name)
    setActive(account.active)
    markClean({ code: account.accountNumber, bankId: account.bankId, openingBalance: String(account.openingBalance ?? ''), openingBalanceDate: account.openingBalanceDate?.slice(0, 10) ?? '', name: account.name, active: account.active, companyId })
    setMode('view')
  }

  function openEdit(account: BankAccount) {
    if (!rec.isRecordTab) return rec.open('edit', account)
    setActiveAccount(account)
    setAccountNumber(account.accountNumber)
    setBankId(account.bankId)
    setOpeningBalance(String(account.openingBalance ?? ''))
    setOpeningBalanceDate(account.openingBalanceDate?.slice(0, 10) ?? '')
    setName(account.name)
    setActive(account.active)
    markClean({ code: account.accountNumber, bankId: account.bankId, openingBalance: String(account.openingBalance ?? ''), openingBalanceDate: account.openingBalanceDate?.slice(0, 10) ?? '', name: account.name, active: account.active, companyId })
    setMode('edit')
  }

  function openCreate() {
    if (!rec.isRecordTab) return rec.open('create')
    setActiveAccount(null)
    setAccountNumber('')
    setBankId('')
    setOpeningBalance('')
    setOpeningBalanceDate('')
    setName('')
    setActive(true)
    const nextCompanyId = activeCompanyId ?? ''
    setCompanyId(nextCompanyId)
    markClean({ code: '', bankId: '', openingBalance: '', openingBalanceDate: '', name: '', active: true, companyId: nextCompanyId })
    setMode('create')
  }

  function requestClose() {
    guardedClose({ accountNumber, bankId, openingBalance, openingBalanceDate, name, active, companyId }, () => rec.close())
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'create' && !companyId) {
      toast('Select a company.', 'error')
      return
    }
    if (!bankId) {
      toast('Select the bank.', 'error')
      return
    }
    if (!window.confirm(mode === 'create' ? `Create bank account "${name}"?` : `Save changes to bank account "${name}"?`)) return
    setLoading(true)
    try {
      if (mode === 'create') {
        await apiFetch<BankAccount>('/bank-accounts', {
          method: 'POST',
          body: JSON.stringify({ accountNumber, bankId, name, openingBalance: openingBalance.trim() !== '' ? Number(openingBalance) : null, openingBalanceDate: openingBalanceDate || null, active, companyId }),
        })
        toast('Bank account created successfully.', 'success')
      } else {
        await apiFetch<BankAccount>(`/bank-accounts/${activeAccount!.id}`, {
          method: 'PUT',
          body: JSON.stringify({ accountNumber, bankId, name, openingBalance: openingBalance.trim() !== '' ? Number(openingBalance) : null, openingBalanceDate: openingBalanceDate || null, active, companyId: activeAccount!.companyId }),
        })
        toast('Bank account updated successfully.', 'success')
      }
      rec.close()
      reload()
    } catch (err) {
      toast(mutationErrorMessage(err, mode === 'create' ? 'Failed to create bank account.' : 'Failed to update bank account.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(account: BankAccount) {
    if (!window.confirm(`Delete bank account "${account.name}"?`)) return
    try {
      await apiFetch(`/bank-accounts/${account.id}`, { method: 'DELETE' })
      toast('Bank account deleted.', 'success')
      reload()
    } catch (err) {
      toast(deleteErrorMessage(err, 'Failed to delete bank account.'), 'error')
    }
  }

  /** One row's displayed value per column key: the export row, and what grouping groups by. */
  function listRow(c: BankAccount) {
    return {
      name: c.name,
      accountNumber: c.accountNumber,
      account: c.bankName,
      openingBalance: formatCurrency(c.openingBalance),
      active: c.active ? 'Yes' : 'No',
      company: c.companyName,
      createdBy: resolveDisplayName(c.createdBy),
      updatedAt: formatDateTime(c.updatedAt),
    }
  }

  async function handleExport() {
    const qs = filtersToQueryString(sorting.apply(debouncedFilters))
    const all = await fetchAllContent<BankAccount>(qs ? `/bank-accounts?${qs}` : '/bank-accounts', 100000)
    const term = debouncedSearch.trim().toLowerCase()
    const matching = term ? all.filter(c => accountSearchText(c).toLowerCase().includes(term)) : all
    const rows = matching.map(listRow)
    exportToXlsx('bank-accounts', COLUMNS.filter(c => isVisible(c.key)), rows, grouping)
  }

  const recordName = activeAccount?.name ?? ''
  const tabTitle = mode === 'create' ? 'New Bank Account' : mode === 'edit' ? `Edit ${recordName}` : recordName || 'Bank Account'
  const ro = mode === 'view'

  return (
    <div className={inRecordTab ? 'space-y-6' : 'flex h-full flex-col gap-6'}>
      {!inRecordTab && (<>
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Bank Accounts</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ReloadButton onReload={reload} loading={listLoading} />
          <ColumnsMenu columns={COLUMNS} {...columnMenu} />
          <GroupByMenu grouping={grouping} view={view} status={allRows} />
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            Export
          </Button>
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              New
              <kbd className="ml-1 px-1 py-0.5 rounded bg-black/10 text-[10px] font-mono">N</kbd>
            </Button>
          )}
          <GlobalSearch value={search} onChange={setSearch} status={searchAll} />
        </div>
      </div>

      </>)}

      {inRecordTab && (
        <RecordSheet title={tabTitle} status={rec.status} onRequestClose={requestClose} className="max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DocSheet>
              <DocLetterhead company={
                  <CompanyField
                    id="acct-company"
                    readOnly={mode !== 'create' || !showCompanyColumn}
                    name={mode === 'create' ? activeCompany?.name : activeAccount?.companyName}
                    companies={companyOptions}
                    value={companyId}
                    onChange={setCompanyId}
                    autoFocus={mode === 'create' && showCompanyColumn}
                  />
              }>
                <DocHeader title="Bank Account Record" />
              </DocLetterhead>
              <DocRow>
                <DocCell label="Bank" htmlFor="acct-bank" required={!ro}>
                  {ro ? <DocText>{activeAccount?.bankName}</DocText> : (
                    <SearchableSelect id="acct-bank" value={bankId === '' ? '' : String(bankId)} onChange={v => setBankId(v ? Number(v) : '')}
                      options={bankOptions.map(b => ({ value: String(b.id), label: b.code ? `${b.code} — ${b.name}` : b.name }))}
                      autoFocus={!(mode === 'create' && showCompanyColumn)} />
                  )}
                </DocCell>
                <DocCell label="Account Number" htmlFor="acct-number" required={!ro}>
                  <Input
                    id="acct-number"
                    value={accountNumber}
                    readOnly={ro}
                    maxLength={50}
                    onChange={e => setAccountNumber(e.target.value)}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Name" htmlFor="acct-name" required={!ro}>
                  <Input
                    id="acct-name"
                    value={name}
                    readOnly={ro}
                    onChange={e => setName(e.target.value)}
                    required={!ro}
                  />
                </DocCell>
                <DocCell label="Status">
                  <DocCheck id="acct-active" label="Active" checked={active} disabled={ro} onChange={setActive} />
                </DocCell>
              </DocRow>
              <DocRow>
                <DocCell label="Opening Balance" htmlFor="acct-opening">
                  <Input id="acct-opening" type="number" step="0.01" value={openingBalance} readOnly={ro} className="text-right"
                    onChange={e => setOpeningBalance(e.target.value)} />
                </DocCell>
                <DocCell label="As of" htmlFor="acct-opening-date">
                  <Input id="acct-opening-date" type="date" value={openingBalanceDate} readOnly={ro} onChange={e => setOpeningBalanceDate(e.target.value)} />
                </DocCell>
              </DocRow>
              {ro && activeAccount && (
                <DocSignatures entries={[
                  { label: 'Created by', value: resolveDisplayName(activeAccount.createdBy) },
                  { label: 'Created at', value: formatDateTime(activeAccount.createdAt) },
                  { label: 'Last updated by', value: resolveDisplayName(activeAccount.updatedBy) },
                  { label: 'Last updated at', value: formatDateTime(activeAccount.updatedAt) },
                ]} />
              )}
              {ro && activeAccount && <ChangeHistory type="BANK" id={activeAccount.id} refreshKey={activeAccount.updatedAt} />}
            </DocSheet>

            <div key={mode} className={RECORD_ACTIONS}>
              {mode === 'view' ? (
                <>
                  <CloseButton onClick={requestClose} />
                  {canUpdate && (
                    <Button type="button" onClick={() => setMode('edit')}>Edit</Button>
                  )}
                </>
              ) : (
                <>
                  <CloseButton onClick={requestClose} label="Cancel" />
                  <Button type="submit" loading={loading}>
                    {mode === 'create' ? 'Create' : 'Save'}
                  </Button>
                </>
              )}
            </div>
          </form>
        </RecordSheet>
      )}

      {!inRecordTab && (<>

      <Card className="flex min-h-0 flex-col">
        <CardContent className="flex min-h-0 flex-col pt-6">
          <ScrollTable activeIndex={activeIndex}>
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                {showCompanyColumn && isVisible('company') && <SortableTh sorting={sorting} column="company" className="text-left py-2 px-4 font-medium">Company</SortableTh>}
                {isVisible('name') && <SortableTh sorting={sorting} column="name" className="text-left py-2 px-4 font-medium">Name</SortableTh>}
                {isVisible('accountNumber') && <SortableTh sorting={sorting} column="accountNumber" className="text-left py-2 px-4 font-medium">Account Number</SortableTh>}
                {isVisible('bank') && <SortableTh sorting={sorting} column="bank" className="text-left py-2 px-4 font-medium">Bank</SortableTh>}
                {isVisible('openingBalance') && <th className="text-right py-2 px-4 font-medium">Opening Balance</th>}
                {isVisible('active') && <SortableTh sorting={sorting} column="active" className="text-left py-2 px-4 font-medium">Active</SortableTh>}
                {isVisible('createdBy') && <SortableTh sorting={sorting} column="createdBy" className="text-left py-2 px-4 font-medium">Created by</SortableTh>}
                {isVisible('updatedAt') && <SortableTh sorting={sorting} column="updatedAt" className="text-left py-2 px-4 font-medium">Last updated</SortableTh>}
                <th className="py-2 px-4" />
              </tr>
              <ColumnFilterRow
                columns={COLUMNS}
                isVisible={isVisible}
                values={filters}
                onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
                filterable={key => key !== 'openingBalance'}
              />
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.filter(c => isVisible(c.key)).length + 1} className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
                    {isFiltering ? 'No bank accounts match your search/filters.' : 'No bank accounts to display.'}
                  </td>
                </tr>
              ) : (
                groupedRows(view, { isVisible, activeIndex, onActivate: setActiveIndex }, (account, i) => (
                  <tr
                    key={account.id}
                    onClick={() => { setActiveIndex(i); openView(account) }}
                    className={cn(
                      'border-b border-[hsl(var(--border))] last:border-0 cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors',
                      i === activeIndex && 'bg-[hsl(var(--secondary))] ring-1 ring-inset ring-[hsl(var(--primary))]'
                    )}
                  >
                    {showCompanyColumn && isVisible('company') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{account.companyName}</td>}
                    {isVisible('name') && <td className="py-2 px-4 font-medium">{account.name}</td>}
                    {isVisible('accountNumber') && <td className="py-2 px-4 font-mono text-xs">{account.accountNumber}</td>}
                    {isVisible('bank') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{account.bankName}</td>}
                    {isVisible('openingBalance') && <td className="py-2 px-4 text-right tabular-nums">{formatCurrency(account.openingBalance)}</td>}
                    {isVisible('active') && (
                      <td className="py-2 px-4">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium',
                          account.active
                            ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                            : 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]'
                        )}>
                          {account.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    )}
                    {isVisible('createdBy') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{resolveDisplayName(account.createdBy)}</td>}
                    {isVisible('updatedAt') && <td className="py-2 px-4 text-[hsl(var(--muted-foreground))]">{formatDateTime(account.updatedAt)}</td>}
                    <td className="py-2 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openView(account)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(account)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteAccount && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(account)}>
                            <Trash2 className="w-4 h-4 text-[hsl(var(--destructive))]" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </ScrollTable>
          <Pagination summary={view.summary} page={page} totalPages={totalPages} totalElements={totalElements} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}
