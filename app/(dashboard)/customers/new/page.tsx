"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { ArrowLeft, Loader2 } from "lucide-react";

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
});
type FormData = z.infer<typeof schema>;

export default function NewCustomerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
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
