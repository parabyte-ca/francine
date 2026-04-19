import { notFound } from "next/navigation";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { getClient, listStandardRates, listCustomRates } from "@/lib/google/sheets";
import { ArrowLeft } from "lucide-react";
import RatesManager from "./RatesManager";
import type { Metadata } from "next";

export const revalidate = 0;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const client = await getClient(params.id);
  return { title: client ? `Rates — ${client.name}` : "Rates" };
}

export default async function CustomerRatesPage({ params }: { params: { id: string } }) {
  const client = await getClient(params.id);
  if (!client) notFound();

  const [standardRates, customRates] = await Promise.all([
    listStandardRates(),
    listCustomRates(params.id),
  ]);

  return (
    <>
      <Topbar
        title={`${client.name} — Custom Rates`}
        subtitle="Override standard pricing for this client"
        actions={
          <Link href={`/customers/${params.id}`} className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
          </Link>
        }
      />
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-6">
          <RatesManager
            clientId={params.id}
            standardRates={standardRates}
            customRates={customRates}
          />
        </div>
      </div>
    </>
  );
}
