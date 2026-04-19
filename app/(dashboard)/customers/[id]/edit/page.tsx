import { notFound } from "next/navigation";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import { getClient } from "@/lib/google/sheets";
import { ArrowLeft } from "lucide-react";
import EditClientForm from "./EditClientForm";
import type { Metadata } from "next";

export const revalidate = 0;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const client = await getClient(params.id);
  return { title: client ? `Edit — ${client.name}` : "Edit Client" };
}

export default async function EditCustomerPage({ params }: { params: { id: string } }) {
  const client = await getClient(params.id);
  if (!client) notFound();

  return (
    <>
      <Topbar
        title={`Edit ${client.name}`}
        subtitle="Update client details"
        actions={
          <Link href={`/customers/${params.id}`} className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
          </Link>
        }
      />
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          <EditClientForm client={client} />
        </div>
      </div>
    </>
  );
}
