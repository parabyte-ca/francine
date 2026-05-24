import type { InvoiceLineItem } from "@/types";

const ASL_PREFIX = "ASL-English Interpretation ";

export function formatDuration(item: InvoiceLineItem): string {
  if (item.service_type.startsWith(ASL_PREFIX)) {
    return item.service_type.slice(ASL_PREFIX.length); // "< 90 min", "2h", "Half Day", "Full Day"
  }
  return "—"; // mileage, parking — price column already shows the amount
}

/** Derives a 2-4 char invoice prefix from a company name (falling back to contact name). */
export function computeClientAbbr(company: string, name: string): string {
  const src = (company.trim() || name.trim());
  const words = src.split(/[\s\-]+/).filter(Boolean);
  if (words.length === 0) return "INV";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  // Short words ≤2 chars (e.g. "TD") contribute all letters; longer words contribute first letter only
  return words.map(w => w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase()).join("").slice(0, 4);
}
