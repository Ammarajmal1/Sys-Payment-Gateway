/**
 * Currency and Integer Paisa Utilities
 * All internal monetary calculations in SysGalaxy Gateway use integer paisa
 * (1 PKR = 100 paisa) to avoid IEEE 754 floating point precision errors.
 */

export function rupeesToPaisa(amountInRupees: number | string): number {
  const numericAmount = typeof amountInRupees === 'string' ? parseFloat(amountInRupees) : amountInRupees;
  if (isNaN(numericAmount) || numericAmount < 0) {
    throw new Error(`Invalid monetary amount: ${amountInRupees}`);
  }
  // Math.round ensures precision when multiplying floats by 100
  return Math.round(numericAmount * 100);
}

export function paisaToRupees(paisa: number | bigint): number {
  const numericPaisa = typeof paisa === 'bigint' ? Number(paisa) : paisa;
  return numericPaisa / 100;
}

export function formatPaisa(paisa: number | bigint, currency = 'PKR'): string {
  const rupees = paisaToRupees(paisa);
  const formatted = new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
  return `${currency} ${formatted}`;
}
