import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  listClients,
  listOrders,
  listStandardRates,
  listCustomRates,
  listAppointments,
  listInvoices,
  listAllLineItems,
} from "@/lib/google/sheets";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [clients, orders, standardRates, customRates, appointments, invoices, lineItems] =
    await Promise.all([
      listClients(),
      listOrders(),
      listStandardRates(false),
      listCustomRates(),
      listAppointments(),
      listInvoices(),
      listAllLineItems(),
    ]);

  const backup = {
    exported_at: new Date().toISOString(),
    version: 1,
    data: { clients, orders, standardRates, customRates, appointments, invoices, lineItems },
  };

  const date = new Date().toISOString().split("T")[0];
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="francine-backup-${date}.json"`,
    },
  });
}
