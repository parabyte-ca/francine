"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Star } from "lucide-react";
import type { StandardRate, CustomRate, RateUnit } from "@/types";

const UNITS: RateUnit[] = ["hour", "flat", "per_item", "per_word", "per_minute"];

interface Props {
  clientId: string;
  standardRates: StandardRate[];
  customRates: CustomRate[];
}

export default function RatesManager({ clientId, standardRates, customRates }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    service_type: "",
    unit: "hour" as RateUnit,
    override_price: "",
    minimum_charge: "0",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  const customMap = Object.fromEntries(customRates.map((r) => [r.service_type, r]));

  const submit = async () => {
    if (!form.service_type) return setError("Service type is required");
    if (!form.override_price) return setError("Override price is required");
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:      clientId,
          service_type:   form.service_type,
          unit:           form.unit,
          override_price: Number(form.override_price),
          minimum_charge: Number(form.minimum_charge) || 0,
          notes:          form.notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
        return;
      }
      setAdding(false);
      setForm({ service_type: "", unit: "hour", override_price: "", minimum_charge: "0", notes: "" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Rate Card</h3>
          <button onClick={() => setAdding(true)} className="btn-primary text-xs py-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Override
          </button>
        </div>

        <div className="divide-y">
          {standardRates.map((rate) => {
            const custom = customMap[rate.service_type];
            return (
              <div key={rate.rate_id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium text-gray-800">{rate.service_type}</p>
                  <p className="text-xs text-gray-500">Standard: ${rate.base_price}/{rate.unit}</p>
                </div>
                {custom ? (
                  <div className="text-right">
                    <span className="font-bold text-yellow-700 flex items-center gap-1 justify-end">
                      <Star className="w-3 h-3" /> ${custom.override_price}/{custom.unit}
                    </span>
                    {custom.minimum_charge > 0 && (
                      <p className="text-xs text-gray-500">Min ${custom.minimum_charge}</p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setForm((f) => ({
                        ...f,
                        service_type: rate.service_type,
                        unit: rate.unit,
                        override_price: String(rate.base_price),
                      }));
                      setAdding(true);
                    }}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    Add override
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {customRates.length > 0 && (
          <div className="mt-6 pt-4 border-t">
            <h4 className="text-xs uppercase text-gray-500 font-medium mb-2">Existing Overrides</h4>
            <div className="space-y-1">
              {customRates.map((r) => (
                <p key={r.custom_rate_id} className="text-xs text-gray-600">
                  <strong>{r.service_type}</strong> — ${r.override_price}/{r.unit}
                  {r.notes && <span className="ml-2 italic">({r.notes})</span>}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {adding && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-6 space-y-4">
              <h2 className="font-semibold text-gray-900">Add Custom Rate</h2>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {error}
                </div>
              )}

              <div>
                <label className="label">Service Type</label>
                <input
                  type="text"
                  className="input"
                  list="services"
                  value={form.service_type}
                  onChange={(e) => setForm((f) => ({ ...f, service_type: e.target.value }))}
                />
                <datalist id="services">
                  {standardRates.map((r) => (
                    <option key={r.rate_id} value={r.service_type} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Unit</label>
                  <select
                    className="input"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value as RateUnit }))}
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u.replace("_", " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Override Price</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="input"
                    value={form.override_price}
                    onChange={(e) => setForm((f) => ({ ...f, override_price: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="label">Minimum Charge</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="input"
                  value={form.minimum_charge}
                  onChange={(e) => setForm((f) => ({ ...f, minimum_charge: e.target.value }))}
                />
              </div>

              <div>
                <label className="label">Notes</label>
                <input
                  type="text"
                  className="input"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setAdding(false)} className="btn-secondary">Cancel</button>
                <button onClick={submit} disabled={loading} className="btn-primary">
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
