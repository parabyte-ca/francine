"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, Loader2 } from "lucide-react";

interface Props {
  orderId: string;
  initialMileage: number;
  initialParking: number;
}

export default function OrderExpenses({ orderId, initialMileage, initialParking }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [mileage, setMileage] = useState(String(initialMileage || 0));
  const [parking, setParking] = useState(String(initialParking || 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mileage_cost: Number(mileage) || 0,
          parking_cost: Number(parking) || 0,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "Failed to save");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setMileage(String(initialMileage || 0));
    setParking(String(initialParking || 0));
    setEditing(false);
    setError(null);
  };

  const mileageVal = Number(mileage) || 0;
  const parkingVal = Number(parking) || 0;

  if (!editing) {
    return (
      <div className="mt-4 pt-4 border-t">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500">Expenses</p>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <span className="text-gray-700">
            Mileage:{" "}
            <span className={mileageVal > 0 ? "font-medium" : "text-gray-400"}>
              {mileageVal > 0 ? `$${mileageVal.toFixed(2)}` : "—"}
            </span>
          </span>
          <span className="text-gray-700">
            Parking:{" "}
            <span className={parkingVal > 0 ? "font-medium" : "text-gray-400"}>
              {parkingVal > 0 ? `$${parkingVal.toFixed(2)}` : "—"}
            </span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t">
      <p className="text-xs text-gray-500 mb-2">Expenses</p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="label text-xs">Mileage ($)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="input w-28"
            value={mileage}
            onChange={(e) => setMileage(e.target.value)}
          />
        </div>
        <div>
          <label className="label text-xs">Parking ($)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="input w-28"
            value={parking}
            onChange={(e) => setParking(e.target.value)}
          />
        </div>
        <div className="flex gap-2 pb-0.5">
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary text-xs py-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save
          </button>
          <button onClick={cancel} disabled={saving} className="btn-secondary text-xs py-1.5">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
