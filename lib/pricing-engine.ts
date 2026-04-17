/**
 * lib/pricing-engine.ts
 *
 * The Pricing Engine resolves the correct price for a given service
 * rendered to a given client.
 *
 * Resolution hierarchy (highest → lowest priority):
 *
 *   1. manual_override  — staff explicitly set a one-off price on the line item
 *   2. custom_rate      — client has a negotiated rate for this service type
 *   3. standard_rate    — the default rate from the Standard_Rates sheet
 *   4. Error            — no rate found; must be resolved before invoicing
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                      PRICING ENGINE LOGIC FLOW                         │
 * │                                                                         │
 * │  resolvePrice(client_id, service_type, quantity, manual_override?)      │
 * │       │                                                                  │
 * │       ├─► manual_override provided?                                     │
 * │       │         YES → return { unit_price: override, source: "manual" } │
 * │       │                                                                  │
 * │       ├─► getCustomRate(client_id, service_type)                        │
 * │       │         FOUND → return { unit_price: custom, source: "custom" } │
 * │       │                                                                  │
 * │       └─► getStandardRate(service_type)                                 │
 * │                 FOUND → return { unit_price: standard, source: "std" }  │
 * │                 NOT FOUND → throw PricingError                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Minimum-charge guard:
 *   final_total = max(quantity × unit_price, minimum_charge)
 */

import { getCustomRate, getStandardRate } from "./google/sheets";
import type { PricingInput, PricingResult, RateUnit } from "@/types";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class PricingError extends Error {
  constructor(
    message: string,
    public readonly service_type: string,
    public readonly client_id: string
  ) {
    super(message);
    this.name = "PricingError";
  }
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the unit price, source, and final total for a billable line item.
 *
 * @param input  - client, service type, quantity, and optional manual override
 * @returns      - unit price, rate source, total (after minimum-charge guard)
 */
export async function resolvePrice(input: PricingInput): Promise<PricingResult> {
  const { client_id, service_type, quantity, manual_override_price } = input;

  // ── Step 1: Manual override (staff-set one-off price) ─────────────────────
  if (manual_override_price !== undefined && manual_override_price !== null) {
    const resolvedUnit = input.unit ?? "hour";
    const total = applyMinimum(quantity, manual_override_price, 0);
    return {
      unit_price: manual_override_price,
      unit: resolvedUnit,
      minimum_charge: 0,
      total_price: total,
      rate_source: "manual_override",
      rate_id: "manual",
      notes: "Price manually overridden by staff",
    };
  }

  // ── Step 2: Client-specific custom rate ───────────────────────────────────
  const customRate = await getCustomRate(client_id, service_type);
  if (customRate) {
    const total = applyMinimum(
      quantity,
      customRate.override_price,
      customRate.minimum_charge
    );
    return {
      unit_price: customRate.override_price,
      unit: customRate.unit,
      minimum_charge: customRate.minimum_charge,
      total_price: total,
      rate_source: "custom",
      rate_id: customRate.custom_rate_id,
      notes: `Custom rate for client (${customRate.notes || "negotiated rate"})`,
    };
  }

  // ── Step 3: Standard rate ─────────────────────────────────────────────────
  const standardRate = await getStandardRate(service_type);
  if (standardRate) {
    const total = applyMinimum(
      quantity,
      standardRate.base_price,
      standardRate.minimum_charge
    );
    return {
      unit_price: standardRate.base_price,
      unit: standardRate.unit,
      minimum_charge: standardRate.minimum_charge,
      total_price: total,
      rate_source: "standard",
      rate_id: standardRate.rate_id,
      notes: `Standard rate: ${standardRate.description}`,
    };
  }

  // ── No rate found ─────────────────────────────────────────────────────────
  throw new PricingError(
    `No rate configured for service type "${service_type}". ` +
      `Add a Standard Rate or a Custom Rate for this client.`,
    service_type,
    client_id
  );
}

// ---------------------------------------------------------------------------
// Batch pricing (for multi-line invoices)
// ---------------------------------------------------------------------------

/**
 * Resolves prices for multiple line items in parallel.
 * Returns results in the same order as inputs.
 */
export async function resolvePriceBatch(
  items: PricingInput[]
): Promise<PricingResult[]> {
  return Promise.all(items.map((item) => resolvePrice(item)));
}

// ---------------------------------------------------------------------------
// Invoice totals calculator
// ---------------------------------------------------------------------------

export interface InvoiceTotals {
  subtotal: number;
  tax_amount: number;
  total: number;
}

/**
 * Given an array of resolved line totals and a tax rate percentage,
 * returns the invoice subtotal, tax, and grand total.
 */
export function calculateInvoiceTotals(
  lineTotals: number[],
  taxRatePercent: number
): InvoiceTotals {
  const subtotal = lineTotals.reduce((sum, t) => sum + t, 0);
  const tax_amount = round2(subtotal * (taxRatePercent / 100));
  const total = round2(subtotal + tax_amount);
  return { subtotal: round2(subtotal), tax_amount, total };
}

// ---------------------------------------------------------------------------
// Helper: apply minimum charge guard
// ---------------------------------------------------------------------------

function applyMinimum(
  quantity: number,
  unitPrice: number,
  minimumCharge: number
): number {
  const raw = round2(quantity * unitPrice);
  return minimumCharge > 0 ? Math.max(raw, minimumCharge) : raw;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Helper: describe a rate unit in human-readable form
// ---------------------------------------------------------------------------

export function formatRateUnit(unit: RateUnit): string {
  const map: Record<RateUnit, string> = {
    hour: "/ hr",
    flat: "flat",
    per_item: "/ item",
    per_word: "/ word",
    per_minute: "/ min",
  };
  return map[unit] ?? unit;
}

// ---------------------------------------------------------------------------
// Pseudocode reference (inline documentation for onboarding)
// ---------------------------------------------------------------------------

/*
 * PSEUDOCODE — Pricing Engine Resolution
 * ───────────────────────────────────────
 *
 * FUNCTION resolvePrice(client_id, service_type, quantity, manual_override?):
 *
 *   IF manual_override IS PROVIDED:
 *     unit_price   ← manual_override
 *     rate_source  ← "manual_override"
 *     minimum      ← 0
 *
 *   ELSE IF Custom_Rate EXISTS FOR (client_id, service_type):
 *     unit_price   ← Custom_Rate.override_price
 *     rate_source  ← "custom"
 *     minimum      ← Custom_Rate.minimum_charge
 *
 *   ELSE IF Standard_Rate EXISTS FOR service_type:
 *     unit_price   ← Standard_Rate.base_price
 *     rate_source  ← "standard"
 *     minimum      ← Standard_Rate.minimum_charge
 *
 *   ELSE:
 *     RAISE PricingError("No rate found")
 *
 *   raw_total    ← quantity × unit_price
 *   final_total  ← MAX(raw_total, minimum)
 *
 *   RETURN { unit_price, rate_source, total_price: final_total }
 *
 * END FUNCTION
 */
