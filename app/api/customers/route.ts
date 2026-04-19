/**
 * GET  /api/customers   — list clients
 * POST /api/customers   — create a new client
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createClient, listClients } from "@/lib/google/sheets";
import type { Client } from "@/types";

const CreateClientSchema = z.object({
  name:                z.string().min(1),
  email:               z.string().email(),
  phone:               z.string().default(""),
  street:              z.string().default(""),
  city:                z.string().default(""),
  province:            z.string().default(""),
  postal_code:         z.string().default(""),
  company:             z.string().default(""),
  language_pair:       z.string().default(""),
  default_tax_exempt:  z.boolean().default(false),
  notes:               z.string().default(""),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.toLowerCase();

  let clients = await listClients();
  if (q) {
    clients = clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q)
    );
  }

  return NextResponse.json({ data: clients });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const now = new Date().toISOString();
  const client: Client = {
    client_id:      uuidv4(),
    has_custom_rates: false,
    ...parsed.data,
    created_at: now,
    updated_at: now,
  };

  await createClient(client);
  return NextResponse.json({ data: client }, { status: 201 });
}
