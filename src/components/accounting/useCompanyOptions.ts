import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { fetchAllContent } from '@/hooks/usePagedList'

export interface CompanyOption {
  id: number
  name: string
}

/** The companies a create form's CompanyField offers: the user's own, or every company for SUPER_ADMIN. */
export function useCompanyOptions(enabled: boolean): CompanyOption[] {
  const { toast } = useToast()
  const { hasPermission, companies } = useAuth()
  const isSuperAdmin = hasPermission('MANAGE_SYSTEM')
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([])
  useEffect(() => {
    if (isSuperAdmin && enabled) {
      fetchAllContent<CompanyOption>('/companies')
        .then(setAllCompanies)
        .catch(() => toast('Failed to load companies.', 'error'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, enabled])
  return isSuperAdmin ? allCompanies : companies
}
