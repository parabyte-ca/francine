import type { InvoiceLineItem } from "@/types";

const ASL_PREFIX = "ASL-English Interpretation ";

export function formatDuration(item: InvoiceLineItem): string {
  if (item.service_type.startsWith(ASL_PREFIX)) {
    return item.service_type.slice(ASL_PREFIX.length); // "< 90 min", "2h", "Half Day", "Full Day"
  }
  return "—"; // mileage, parking — price column already shows the amount
}
