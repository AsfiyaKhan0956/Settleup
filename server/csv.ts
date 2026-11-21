/** Shared CSV formatting helpers. Dates are displayed consistently for spreadsheet users. */
export function formatCsvDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

export function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  // Prevent spreadsheet formula injection in untrusted text cells. Numeric values remain numeric.
  if (typeof value === 'string' && /^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvDocument(rows: Array<Array<string | number | null | undefined>>): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}
