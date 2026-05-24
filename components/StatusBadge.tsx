import { clsx } from "clsx";
import type { OrderStatus, InvoiceStatus, AppointmentStatus } from "@/types";

type AnyStatus = OrderStatus | InvoiceStatus | AppointmentStatus;

const STATUS_MAP: Record<string, string> = {
  // Order statuses
  quote:       "badge-yellow",
  scheduled:   "badge-blue",
  completed:   "badge-green",
  cancelled:   "badge-red",
  // Invoice statuses
  draft:       "badge-gray",
  sent:        "badge-blue",
  paid:        "badge-green",
  overdue:     "badge-red",
  void:        "badge-gray",
  // Appointment statuses
  confirmed:   "badge-green",
  no_show:     "badge-red",
};

const LABELS: Record<string, string> = {
  no_show: "No Show",
};

export default function StatusBadge({ status }: { status: AnyStatus }) {
  const className = STATUS_MAP[status] ?? "badge-gray";
  const label = LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={className}>{label}</span>;
}
