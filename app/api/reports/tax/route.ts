/**
 * GET /api/reports/tax
 *
 * Generates a year-end income / HST summary for Ontario tax filing.
 *
 * Query params:
 *   from    ISO date (default: Jan 1 of current year)
 *   to      ISO date (default: Dec 31 of current year)
 *   format  "csv" | "json"  (default: "csv")
 *
 * CSV response triggers a browser file download.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listInvoices, getClient } from "@/lib/google/sheets";
import type { Invoice } from "@/types";

const EXCLUDED_STATUSES = new Set(["draft", "void"]);

function isoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function defaultFrom(): string {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function defaultTo(): string {
  const d = new Date();
  return `${d.getFullYear()}-12-31`;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildReport(invoices: Invoice[], from: string, to: string) {
  const filtered = invoices.filter(
    (inv) =>
      !EXCLUDED_STATUSES.has(inv.status) &&
      inv.issue_date >= from &&
      inv.issue_date <= to
  );

  // Summary
  let totalSubtotal = 0, totalHst = 0, totalBilled = 0, paidTotal = 0, outstandingTotal = 0;
  for (const inv of filtered) {
    totalSubtotal   += inv.subtotal;
    totalHst        += inv.tax_amount;
    totalBilled     += inv.total;
    if (inv.status === "paid") paidTotal += inv.total;
    else outstandingTotal += inv.total;
  }

  // Monthly breakdown
  const monthly: Record<string, { count: number; subtotal: number; hst: number; total: number; paid: number; outstanding: number }> = {};
  for (const inv of filtered) {
    const key = inv.issue_date.slice(0, 7); // "YYYY-MM"
    if (!monthly[key]) monthly[key] = { count: 0, subtotal: 0, hst: 0, total: 0, paid: 0, outstanding: 0 };
    monthly[key].count++;
    monthly[key].subtotal += inv.subtotal;
    monthly[key].hst += inv.tax_amount;
    monthly[key].total += inv.total;
    if (inv.status === "paid") monthly[key].paid += inv.total;
    else monthly[key].outstanding += inv.total;
  }

  return { filtered, summary: { count: filtered.length, totalSubtotal, totalHst, totalBilled, paidTotal, outstandingTotal }, monthly };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from   = searchParams.get("from") || defaultFrom();
  const to     = searchParams.get("to")   || defaultTo();
  const format = searchParams.get("format") || "csv";

  const allInvoices = await listInvoices({});
  const { filtered, summary, monthly } = buildReport(allInvoices, from, to);

  if (format === "json") {
    const monthlyArr = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => {
        const [y, m] = key.split("-");
        return { month: `${MONTH_NAMES[Number(m) - 1]} ${y}`, ...v };
      });
    return NextResponse.json({ from, to, summary, monthly: monthlyArr, invoices: filtered });
  }

  // Build CSV
  const year = from.slice(0, 4);
  const generated = isoDate(new Date());

  const clientCache: Record<string, string> = {};
  const clientName = async (id: string) => {
    if (!clientCache[id]) {
      const c = await getClient(id);
      clientCache[id] = c?.name ?? id;
    }
    return clientCache[id];
  };

  const rows: string[] = [];

  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;

  rows.push(`Francine CRM - Tax Report`);
  rows.push(`Period,${from} to ${to}`);
  rows.push(`Generated,${generated}`);
  rows.push("");

  rows.push("SUMMARY");
  rows.push(`Total Invoices,${summary.count}`);
  rows.push(`Total Subtotal,$${fmt(summary.totalSubtotal)}`);
  rows.push(`HST Collected,$${fmt(summary.totalHst)}`);
  rows.push(`Total Billed,$${fmt(summary.totalBilled)}`);
  rows.push(`Paid,$${fmt(summary.paidTotal)}`);
  rows.push(`Outstanding,$${fmt(summary.outstandingTotal)}`);
  rows.push("");

  rows.push("MONTHLY BREAKDOWN");
  rows.push("Month,Invoice Count,Subtotal,HST,Total,Paid,Outstanding");
  const sortedMonths = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, v] of sortedMonths) {
    const [y, m] = key.split("-");
    const label = `${MONTH_NAMES[Number(m) - 1]} ${y}`;
    rows.push(`${cell(label)},${v.count},${fmt(v.subtotal)},${fmt(v.hst)},${fmt(v.total)},${fmt(v.paid)},${fmt(v.outstanding)}`);
  }
  rows.push("");

  rows.push("INVOICE DETAIL");
  rows.push("Invoice #,Issue Date,Due Date,Client,Status,Subtotal,HST,Total");
  for (const inv of filtered.sort((a, b) => a.issue_date.localeCompare(b.issue_date))) {
    const name = await clientName(inv.client_id);
    rows.push(
      [
        cell(inv.invoice_number),
        inv.issue_date,
        inv.due_date,
        cell(name),
        inv.status,
        fmt(inv.subtotal),
        fmt(inv.tax_amount),
        fmt(inv.total),
      ].join(",")
    );
  }

  const csv = rows.join("\r\n");
  const filename = `tax-report-${year}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
