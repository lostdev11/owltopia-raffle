'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ADMIN_OPS_LOG_ASSETS, type AdminOpsLogAsset } from '@/lib/admin-ops-log/constants'
import type { AdminOpsLogPaymentRow } from '@/lib/admin-ops-log/payment-types'
import { formatPaymentTotalsByAsset, totalsForOpsLogEntry } from '@/lib/admin-ops-log/totals'
import type { AdminOpsLogRow } from '@/lib/db/admin-ops-log'
import { solscanAccountUrl, solscanTransactionUrl } from '@/lib/solana/solscan'
import { ExternalLink, Loader2, Pencil, Trash2 } from 'lucide-react'

const emptyPaymentForm = {
  amount: '',
  asset: '' as AdminOpsLogAsset | '',
  from_wallet: '',
  to_wallet: '',
  tx_signature: '',
  related_pack_open_id: '',
  note: '',
}

function truncateMiddle(value: string, max = 14): string {
  const t = value.trim()
  if (t.length <= max) return t
  return `${t.slice(0, 6)}…${t.slice(-4)}`
}

function formatWhen(iso: string): string {
  const d = Date.parse(iso)
  if (!Number.isFinite(d)) return '—'
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type Props = {
  entry: AdminOpsLogRow
  payments: AdminOpsLogPaymentRow[]
  loading: boolean
  onPaymentsChange: (payments: AdminOpsLogPaymentRow[]) => void
  onTotalsChange: (totals: AdminOpsLogRow['payment_totals']) => void
}

export function AdminOpsLogPaymentsSection({
  entry,
  payments,
  loading,
  onPaymentsChange,
  onTotalsChange,
}: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(emptyPaymentForm)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addWarning, setAddWarning] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(emptyPaymentForm)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editWarning, setEditWarning] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const totals = totalsForOpsLogEntry(
    payments.map((p) => ({ amount: p.amount, asset: p.asset })),
    { amount: entry.amount, asset: entry.asset }
  )
  const totalsLabel = formatPaymentTotalsByAsset(totals)

  function pushTotals(next: AdminOpsLogPaymentRow[]) {
    onPaymentsChange(next)
    onTotalsChange(
      totalsForOpsLogEntry(
        next.map((p) => ({ amount: p.amount, asset: p.asset })),
        { amount: entry.amount, asset: entry.asset }
      )
    )
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    setAddWarning(null)
    setAddSaving(true)
    try {
      const body: Record<string, unknown> = {
        from_wallet: addForm.from_wallet.trim() || null,
        to_wallet: addForm.to_wallet.trim() || null,
        tx_signature: addForm.tx_signature.trim() || null,
        related_pack_open_id: addForm.related_pack_open_id.trim() || null,
        note: addForm.note.trim() || null,
        asset: addForm.asset || null,
      }
      if (addForm.amount.trim()) {
        const n = Number(addForm.amount)
        if (!Number.isFinite(n)) {
          setAddError('Invalid amount')
          return
        }
        body.amount = n
      }
      const res = await fetch(`/api/admin/ops-log/${encodeURIComponent(entry.id)}/payments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAddError(typeof data.error === 'string' ? data.error : 'Could not add payment')
        return
      }
      if (typeof data.warning === 'string') setAddWarning(data.warning)
      if (data.payment) {
        pushTotals([...payments, data.payment as AdminOpsLogPaymentRow])
        setAddForm(emptyPaymentForm)
        setShowAdd(false)
      }
    } finally {
      setAddSaving(false)
    }
  }

  function startEdit(p: AdminOpsLogPaymentRow) {
    setEditingId(p.id)
    setEditError(null)
    setEditWarning(null)
    setEditForm({
      amount: p.amount != null ? String(p.amount) : '',
      asset: p.asset ?? '',
      from_wallet: p.from_wallet ?? '',
      to_wallet: p.to_wallet ?? '',
      tx_signature: p.tx_signature ?? '',
      related_pack_open_id: p.related_pack_open_id ?? '',
      note: p.note ?? '',
    })
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editingId) return
    setEditError(null)
    setEditWarning(null)
    setEditSaving(true)
    try {
      const body: Record<string, unknown> = {
        from_wallet: editForm.from_wallet.trim() || null,
        to_wallet: editForm.to_wallet.trim() || null,
        tx_signature: editForm.tx_signature.trim() || null,
        related_pack_open_id: editForm.related_pack_open_id.trim() || null,
        note: editForm.note.trim() || null,
        asset: editForm.asset || null,
      }
      if (editForm.amount.trim()) {
        const n = Number(editForm.amount)
        if (!Number.isFinite(n)) {
          setEditError('Invalid amount')
          return
        }
        body.amount = n
      } else {
        body.amount = null
      }
      const res = await fetch(
        `/api/admin/ops-log/${encodeURIComponent(entry.id)}/payments/${encodeURIComponent(editingId)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEditError(typeof data.error === 'string' ? data.error : 'Could not save payment')
        return
      }
      if (typeof data.warning === 'string') setEditWarning(data.warning)
      if (data.payment) {
        const updated = data.payment as AdminOpsLogPaymentRow
        pushTotals(payments.map((p) => (p.id === editingId ? updated : p)))
        setEditingId(null)
      }
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(paymentId: string) {
    if (!window.confirm('Remove this payment line?')) return
    setDeletingId(paymentId)
    try {
      const res = await fetch(
        `/api/admin/ops-log/${encodeURIComponent(entry.id)}/payments/${encodeURIComponent(paymentId)}`,
        { method: 'DELETE', credentials: 'include' }
      )
      if (res.ok) {
        pushTotals(payments.filter((p) => p.id !== paymentId))
        if (editingId === paymentId) setEditingId(null)
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Payments</p>
          <p className="text-xs text-muted-foreground">Running total: {totalsLabel}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="touch-manipulation min-h-[40px]"
          onClick={() => setShowAdd((v) => !v)}
        >
          {showAdd ? 'Cancel' : 'Add payment'}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment lines yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="p-1.5 font-medium">Amount</th>
                <th className="p-1.5 font-medium">From / to</th>
                <th className="p-1.5 font-medium">Tx</th>
                <th className="p-1.5 font-medium">Pack open</th>
                <th className="p-1.5 font-medium">Logged</th>
                <th className="p-1.5 w-16" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) =>
                editingId === p.id ? (
                  <tr key={p.id} className="border-t">
                    <td colSpan={6} className="p-2">
                      <form onSubmit={(e) => void handleEditSave(e)} className="space-y-2">
                        {editError ? <p className="text-destructive">{editError}</p> : null}
                        {editWarning ? <p className="text-amber-600 dark:text-amber-400">{editWarning}</p> : null}
                        <div className="grid gap-2 md:grid-cols-3">
                          <Input
                            placeholder="Amount"
                            inputMode="decimal"
                            value={editForm.amount}
                            onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                          />
                          <select
                            className="flex h-10 rounded-md border border-input bg-background px-2 text-sm"
                            value={editForm.asset}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, asset: e.target.value as AdminOpsLogAsset | '' }))
                            }
                          >
                            <option value="">Asset</option>
                            {ADMIN_OPS_LOG_ASSETS.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                          <Input
                            placeholder="Tx signature"
                            value={editForm.tx_signature}
                            onChange={(e) => setEditForm((f) => ({ ...f, tx_signature: e.target.value }))}
                          />
                          <Input
                            placeholder="From wallet"
                            value={editForm.from_wallet}
                            onChange={(e) => setEditForm((f) => ({ ...f, from_wallet: e.target.value }))}
                          />
                          <Input
                            placeholder="To wallet"
                            value={editForm.to_wallet}
                            onChange={(e) => setEditForm((f) => ({ ...f, to_wallet: e.target.value }))}
                          />
                          <Input
                            placeholder="Pack open id"
                            value={editForm.related_pack_open_id}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, related_pack_open_id: e.target.value }))
                            }
                          />
                          <Input
                            className="md:col-span-3"
                            placeholder="Note"
                            value={editForm.note}
                            onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={editSaving}>
                            {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save payment'}
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id} className="border-t align-top">
                    <td className="p-1.5 whitespace-nowrap">
                      {p.amount != null ? (
                        <>
                          {p.amount} {p.asset ?? ''}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-1.5 space-y-0.5">
                      {p.from_wallet ? (
                        <a
                          href={solscanAccountUrl(p.from_wallet)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-primary hover:underline"
                        >
                          from {truncateMiddle(p.from_wallet)}
                        </a>
                      ) : null}
                      {p.to_wallet ? (
                        <a
                          href={solscanAccountUrl(p.to_wallet)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-primary hover:underline"
                        >
                          to {truncateMiddle(p.to_wallet)}
                        </a>
                      ) : null}
                    </td>
                    <td className="p-1.5">
                      {p.tx_signature ? (
                        <a
                          href={solscanTransactionUrl(p.tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {truncateMiddle(p.tx_signature, 12)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="p-1.5 max-w-[120px] truncate" title={p.related_pack_open_id ?? undefined}>
                      {p.related_pack_open_id ? truncateMiddle(p.related_pack_open_id, 18) : '—'}
                    </td>
                    <td className="p-1.5">
                      <div>{formatWhen(p.created_at)}</div>
                      <div className="text-muted-foreground">{truncateMiddle(p.created_by_wallet)}</div>
                      {p.note ? <div className="text-muted-foreground truncate">{p.note}</div> : null}
                    </td>
                    <td className="p-1.5">
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEdit(p)}
                          title="Edit payment"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={deletingId === p.id}
                          onClick={() => void handleDelete(p.id)}
                          title="Delete payment"
                        >
                          {deletingId === p.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAdd ? (
        <form onSubmit={(e) => void handleAdd(e)} className="space-y-2 rounded border bg-background p-3">
          <p className="text-sm font-medium">New payment</p>
          {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
          {addWarning ? <p className="text-sm text-amber-600 dark:text-amber-400">{addWarning}</p> : null}
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <Label htmlFor={`pay-amt-${entry.id}`}>Amount</Label>
              <Input
                id={`pay-amt-${entry.id}`}
                inputMode="decimal"
                value={addForm.amount}
                onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor={`pay-asset-${entry.id}`}>Asset</Label>
              <select
                id={`pay-asset-${entry.id}`}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={addForm.asset}
                onChange={(e) => setAddForm((f) => ({ ...f, asset: e.target.value as AdminOpsLogAsset | '' }))}
              >
                <option value="">—</option>
                {ADMIN_OPS_LOG_ASSETS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`pay-from-${entry.id}`}>From wallet</Label>
              <Input
                id={`pay-from-${entry.id}`}
                value={addForm.from_wallet}
                onChange={(e) => setAddForm((f) => ({ ...f, from_wallet: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor={`pay-to-${entry.id}`}>To wallet</Label>
              <Input
                id={`pay-to-${entry.id}`}
                value={addForm.to_wallet}
                onChange={(e) => setAddForm((f) => ({ ...f, to_wallet: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor={`pay-tx-${entry.id}`}>Tx signature</Label>
              <Input
                id={`pay-tx-${entry.id}`}
                value={addForm.tx_signature}
                onChange={(e) => setAddForm((f) => ({ ...f, tx_signature: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor={`pay-pack-${entry.id}`}>Related pack open id</Label>
              <Input
                id={`pay-pack-${entry.id}`}
                value={addForm.related_pack_open_id}
                onChange={(e) => setAddForm((f) => ({ ...f, related_pack_open_id: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor={`pay-note-${entry.id}`}>Note</Label>
              <Input
                id={`pay-note-${entry.id}`}
                value={addForm.note}
                onChange={(e) => setAddForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
          </div>
          <Button type="submit" disabled={addSaving} className="touch-manipulation min-h-[40px]">
            {addSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save payment
          </Button>
        </form>
      ) : null}
    </div>
  )
}

/** Prefill first payment fields on the create-entry form from Pack opens deep link. */
export function applyPackOpensPaymentPrefill(
  form: typeof emptyPaymentForm,
  prefillToWallet: string | null,
  prefillPackOpenId: string | null
): typeof emptyPaymentForm {
  return {
    ...form,
    to_wallet: prefillToWallet ?? form.to_wallet,
    related_pack_open_id: prefillPackOpenId ?? form.related_pack_open_id,
  }
}

export { emptyPaymentForm as emptyOpsLogPaymentForm }
