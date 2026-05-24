"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";

function autoAbbreviation(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words[0]?.length >= 2) return words[0].slice(0, 2).toUpperCase();
  return (words[0] || "XX").toUpperCase().padEnd(2, "X").slice(0, 2);
}

const schema = z.object({
  name:               z.string().min(1, "Name is required"),
  email:              z.string().email("Valid email required"),
  phone:              z.string().default(""),
  street:             z.string().default(""),
  city:               z.string().default(""),
  province:           z.string().default(""),
  postal_code:        z.string().default(""),
  company:            z.string().default(""),
  language_pair:      z.string().default(""),
  default_tax_exempt: z.boolean().default(false),
  notes:              z.string().default(""),
  abbreviation:       z.string().default(""),
});
type FormData = z.infer<typeof schema>;

export default function NewCustomerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abbrManual, setAbbrManual] = useState(false);
  const [contacts, setContacts] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const nameValue = watch("name", "");

  // Auto-generate abbreviation from name unless the user has overridden it
  useEffect(() => {
    if (!abbrManual && nameValue) {
      setValue("abbreviation", autoAbbreviation(nameValue));
    }
  }, [nameValue, abbrManual, setValue]);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, contacts: contacts.filter(Boolean).join(", ") }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
        return;
      }
      const json = await res.json();
      router.push(`/customers/${json.data.client_id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Topbar
        title="New Client"
        subtitle="Add a client to your database"
        actions={
          <Link href="/customers" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
          </Link>
        }
      />
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleSubmit(onSubmit)} className="card space-y-5">
            <h2 className="font-semibold text-gray-900">Client Details</h2>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Name *</label>
                <input type="text" {...register("name")} className="input" />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="label">Company</label>
                <input type="text" {...register("company")} className="input" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">
                  Abbreviation
                  <span className="ml-1 text-xs font-normal text-gray-400">(used in invoice numbers, e.g. HL)</span>
                </label>
                <input
                  type="text"
                  {...register("abbreviation")}
                  className="input font-mono uppercase"
                  maxLength={4}
                  placeholder="Auto"
                  onChange={(e) => {
                    setAbbrManual(e.target.value.length > 0);
                    setValue("abbreviation", e.target.value.toUpperCase().slice(0, 4));
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Email *</label>
                <input type="email" {...register("email")} className="input" />
                {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <label className="label">Phone</label>
                <input type="tel" {...register("phone")} className="input" />
              </div>
            </div>

            <div>
              <label className="label">Street</label>
              <input type="text" {...register("street")} className="input" placeholder="123 Main St" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <label className="label">City</label>
                <input type="text" {...register("city")} className="input" />
              </div>
              <div>
                <label className="label">Province</label>
                <input type="text" {...register("province")} className="input" placeholder="ON" maxLength={2} />
              </div>
              <div>
                <label className="label">Postal Code</label>
                <input type="text" {...register("postal_code")} className="input" placeholder="A1A 1A1" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Language Pair</label>
                <input
                  type="text"
                  {...register("language_pair")}
                  className="input"
                  placeholder="e.g. EN-FR"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" {...register("default_tax_exempt")} className="rounded" />
                  Tax Exempt
                </label>
              </div>
            </div>

            <div>
              <label className="label">Notes</label>
              <textarea {...register("notes")} className="input resize-none" rows={3} />
            </div>

            {/* Team contacts */}
            <div>
              <label className="label">Team Contacts</label>
              <p className="text-xs text-gray-500 mb-2">People at this client&apos;s organization involved in bookings.</p>
              <div className="space-y-2">
                {contacts.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      className="input flex-1"
                      value={c}
                      placeholder="Contact name"
                      onChange={(e) => setContacts((prev) => prev.map((v, idx) => idx === i ? e.target.value : v))}
                    />
                    <button
                      type="button"
                      onClick={() => setContacts((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                      aria-label="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setContacts((prev) => [...prev, ""])}
                  className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Contact
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/customers" className="btn-secondary">Cancel</Link>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Client
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
