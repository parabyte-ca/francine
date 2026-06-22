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
  const sorted = [...clients].sort((a, b) => {
    const aName = a.company || a.name;
    const bName = b.company || b.name;
    return aName.localeCompare(bName);
  });

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
      {sorted.map((client) => {
        const abbr = (client.abbreviation || client.name.slice(0, 2)).toUpperCase();
        const orgLine = client.company && client.department
          ? `${client.company} — ${client.department}`
          : client.company || "";
        return (
          <Link
            key={client.client_id}
            href={`/customers/${client.client_id}`}
            className="card hover:shadow-md transition-shadow group"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                {abbr.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <p className="font-medium text-gray-900 truncate">
                    {orgLine || client.name}
                  </p>
                  {client.has_custom_rates && (
                    <Star className="w-3 h-3 text-yellow-500 flex-shrink-0" aria-label="Custom rates" />
                  )}
                </div>
                {orgLine && (
                  <p className="text-xs text-gray-500 truncate">{client.name}</p>
                )}
                <p className="text-xs text-gray-400 truncate mt-0.5">{client.email}</p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <>
      <Topbar
        title="Clients"
        subtitle="Client database"
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
