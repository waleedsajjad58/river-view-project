function replaceTemplateTokens(template: string, data: Record<string, string>): string {
  return Object.entries(data).reduce((html, [token, value]) => {
    const safeValue = value ?? ''
    return html.replace(new RegExp(`\\{\\{${token}\\}\\}`, 'g'), safeValue)
  }, template)
}

export function populateBillHTML(template: string, data: any): string {
  const fmt = (val: any) => {
    if (!val || Number(val) === 0) return '-'
    return Number(val).toLocaleString('en-PK')
  }

  const tokens: Record<string, string> = {
    PLOT_NO: data?.plot_no || '',
    MEMBERSHIP_NO: data?.membership_no || '',
    MEMBER_NAME: data?.member_name || '',
    TENANT_NAME: data?.tenant_name || '',
    CHALLAN_NO: data?.challan_no || data?.bill_number || '',
    BILL_MONTH: data?.bill_month || '',
    ISSUED_ON: data?.issued_on || '',
    DUE_DATE: data?.due_date || '',
    PAID_UPTO: data?.paid_upto || '',
    TENANT_PAID_UPTO: data?.tenant_paid_upto || '',
    ADV_PERIOD: data?.advance_period_label || '',
    RECEIPT_PERIOD: data?.receipt_period || data?.advance_period_label || '',
    MONTHLY_CONTRIBUTION: fmt(data?.monthly_contribution),
    ARREARS: fmt(data?.arrears),
    GARBAGE_CHARGES: fmt(data?.garbage_charges),
    AQUIFER_CHARGES: fmt(data?.aquifer_charges),
    TENANT_MONTHLY: fmt(data?.tenant_monthly),
    TENANT_GARBAGE: fmt(data?.tenant_garbage),
    TENANT_AQUIFER: fmt(data?.tenant_aquifer),
    SUBDIVISION: fmt(data?.subdivision),
    ADV_MONTHLY: fmt(data?.adv_monthly),
    ADV_AQUIFER: fmt(data?.adv_aquifer),
    ADV_GARBAGE: fmt(data?.adv_garbage),
    PARK_BOOKING: fmt(data?.park_booking),
    MOSQUE: fmt(data?.mosque),
    CURRENT_TOTAL: fmt(data?.current_total),
    PAYABLE_AMOUNT: fmt(data?.payable_amount),
    PAYABLE_AFTER_DUE: fmt(data?.payable_after_due)
  }

  return replaceTemplateTokens(template, tokens)
}

export async function printBill(billId: number) {
  const html = await (window as any).ipcRenderer.invoke('db:print-bill', billId)
  await (window as any).ipcRenderer.invoke('db:open-print-window', html)
}
