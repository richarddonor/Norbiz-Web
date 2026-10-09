import { formatQuantity } from '@/lib/format'
import { HBarList, SegmentBar, StatTile } from './charts'
import { compactNumber, useWidgetData } from './hooks'
import { SectionLabel, WidgetBody, type WidgetProps } from './widget-kit'

interface KindTotal { kind: 'MAIN' | 'OUTLET' | 'OTHER'; warehouseCount: number; transitQuantity: number; onHandQuantity: number }
interface WarehouseTotal { id: number | null; name: string; kind: string | null; itemsInTransit: number; transitQuantity: number; onHandQuantity: number }
interface StockInTransit {
  transitQuantity: number
  onHandQuantity: number
  warehousesWithTransit: number
  itemsInTransit: number
  byKind: KindTotal[]
  warehouses: WarehouseTotal[]
}

const KIND_LABELS: Record<string, string> = { MAIN: 'Main warehouse', OUTLET: 'Outlet warehouses', OTHER: 'Other warehouses' }
const integer = (n: number) => Math.round(n).toLocaleString('en-PH')
const signed = (n: number) => (n < 0 ? '−' : '') + compactNumber(Math.abs(n))

export function StockInTransitWidget({ refreshKey }: WidgetProps) {
  const state = useWidgetData<StockInTransit>('/dashboard/widgets/stock-in-transit', refreshKey)
  return (
    <WidgetBody state={state}>
      {d => {
        const transit = Number(d.transitQuantity)
        const onHand = Number(d.onHandQuantity)
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              <StatTile label="Units in transit" value={transit} format={n => formatQuantity(Math.round(n))} hint="net, across all warehouses" />
              <StatTile label="Units on hand" value={onHand} format={n => formatQuantity(Math.round(n))}
                hint={onHand > 0 ? `transit = ${((Math.abs(transit) / onHand) * 100).toFixed(1)}% of on hand` : undefined} />
              <StatTile label="Warehouses" value={d.warehousesWithTransit} format={integer} hint="with stock in transit" />
              <StatTile label="Items" value={d.itemsInTransit} format={integer} hint="with stock in transit" />
            </div>

            <div>
              <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">units in transit</span>}>By warehouse kind</SectionLabel>
              <SegmentBar
                format={signed}
                segments={d.byKind.map(k => ({
                  key: k.kind,
                  label: `${KIND_LABELS[k.kind] ?? k.kind} (${k.warehouseCount})`,
                  value: Math.abs(Number(k.transitQuantity)),
                  detail: `${formatQuantity(k.transitQuantity)} in transit, ${formatQuantity(k.onHandQuantity)} on hand`,
                }))}
              />
              <p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                Main warehouse transit includes incoming purchases and pull-outs, net of stock held for open transfers (negative). Outlet transit is deliveries not yet received.
              </p>
            </div>

            <div>
              <SectionLabel aside={<span className="text-[11px] text-[hsl(var(--muted-foreground))]">in transit · on hand</span>}>Warehouses with stock in transit</SectionLabel>
              <HBarList
                format={compactNumber}
                data={d.warehouses.filter(w => w.id != null).map(w => ({
                  key: w.id!,
                  label: w.name,
                  value: Math.abs(Number(w.transitQuantity)),
                  display: `${signed(Number(w.transitQuantity))} · ${compactNumber(Number(w.onHandQuantity))}`,
                  detail: `${integer(w.itemsInTransit)} items in transit`,
                }))}
              />
              {d.warehouses.filter(w => w.id == null).map(w => (
                <p key="others" className="mt-3 border-t pt-2 text-xs text-[hsl(var(--muted-foreground))]">
                  + {w.name.replace(/^Others \((\d+)\)$/, '$1 more warehouses')}:{' '}
                  <span className="dash-readout text-[hsl(var(--foreground))]">{formatQuantity(w.transitQuantity)}</span> units in transit
                </p>
              ))}
            </div>
          </div>
        )
      }}
    </WidgetBody>
  )
}
