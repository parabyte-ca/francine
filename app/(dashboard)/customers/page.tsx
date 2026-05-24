import { Suspense } from "react";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { listClients } from "@/lib/google/sheets";
import { Plus, Star } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Clients" };
export const revalidate = 60;

async function ClientsGrid() {
  const clients = await listClients();
  const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name));

  if (sorted.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p>No clients yet.</p>
        <Link href="/customers/new" className="text-brand-600 hover:underline mt-2 inline-block">
          Add your first client
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {sorted.map((client) => (
        <Link
          key={client.client_id}
          href={`/customers/${client.client_id}`}
          className="card hover:shadow-md transition-shadow group"
        >
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
              {client.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <p className="font-medium text-gray-900 truncate">{client.name}</p>
                {client.has_custom_rates && (
                  <Star className="w-3 h-3 text-yellow-500 flex-shrink-0" aria-label="Custom rates" />
                )}
              </div>
              {client.company && <p className="text-xs text-gray-500 truncate">{client.company}</p>}
              <p className="text-xs text-gray-400 truncate mt-0.5">{client.email}</p>
            </div>
          </div>
          {client.language_pair && (
            <div className="mt-3 pt-3 border-t flex items-center justify-between">
              <span className="text-xs badge-blue">{client.language_pair}</span>
              {client.default_tax_exempt && (
                <span className="text-xs badge-green">Tax Exempt</span>
              )}
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <>
      <Topbar
        title="Clients"
        subtitle="Client database and rate cards"
        actions={
          <Link href="/customers/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Client
          </Link>
        }
      />
      <div className="flex-1 p-6 overflow-y-auto">
        <Suspense fallback={<p className="text-sm text-gray-400">Loading clients…</p>}>
          <ClientsGrid />
        </Suspense>
      </div>
    </>
  );
}
