/**
 * POST /api/dev/seed-customer
 *
 * Development-only endpoint. Generates one realistic fake Canadian client
 * (Ontario-based) and writes it to the Clients sheet.
 *
 * TODO: Remove before production.
 */

import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth } from "@/lib/auth";
import { createClient } from "@/lib/google/sheets";
import type { Client } from "@/types";

const FIRST_NAMES = [
  "James", "Emma", "Liam", "Olivia", "Noah", "Ava", "William", "Sophia",
  "Benjamin", "Isabella", "Elijah", "Mia", "Lucas", "Charlotte", "Mason",
  "Amelia", "Ethan", "Harper", "Alexander", "Evelyn",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Wilson", "Taylor", "Anderson", "Thomas", "Jackson", "White",
  "Harris", "Martin", "Thompson", "Young", "Lee", "Walker",
];

const COMPANIES = [
  "Shopify Inc.", "Loblaw Companies", "RBC Capital Markets",
  "TD Asset Management", "Manulife Financial", "Scotiabank",
  "Sun Life Financial", "CIBC", "Intact Financial Corporation",
  "Bombardier Inc.", "Magna International", "Suncor Energy",
  "Rogers Communications", "BCE Inc.", "Brookfield Asset Management",
  "Fairfax Financial Holdings", "Empire Company Limited",
  "Great-West Lifeco", "Power Corporation of Canada", "Hydro One",
];

const LANGUAGE_PAIRS = ["EN-FR", "EN-ES", "FR-ES", "EN-AR", "EN-ZH", "EN-PT", ""];

const ONTARIO_CITIES: Array<{ city: string; postalPrefix: string }> = [
  { city: "Toronto",      postalPrefix: "M5" },
  { city: "Mississauga",  postalPrefix: "L5" },
  { city: "Ottawa",       postalPrefix: "K1A" },
  { city: "Hamilton",     postalPrefix: "L8N" },
  { city: "London",       postalPrefix: "N6A" },
  { city: "Kitchener",    postalPrefix: "N2G" },
  { city: "Windsor",      postalPrefix: "N8X" },
  { city: "Barrie",       postalPrefix: "L4M" },
  { city: "Kingston",     postalPrefix: "K7L" },
  { city: "Sudbury",      postalPrefix: "P3C" },
];

const STREET_NAMES = [
  "King", "Queen", "Bay", "Yonge", "Bloor", "Dundas", "College",
  "University", "Spadina", "Bathurst", "Dufferin", "Keele",
  "Victoria", "Wellington", "Richmond", "Adelaide", "Front",
];

const STREET_SUFFIXES = ["St", "Ave", "Blvd", "Dr", "Rd", "Cres", "Way", "Lane"];

const POSTAL_LETTERS = "ABCEGHJKLMNPRSTVWXYZ";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generatePostalCode(prefix: string): string {
  const letter = POSTAL_LETTERS[Math.floor(Math.random() * POSTAL_LETTERS.length)];
  const digit  = rand(0, 9);
  const letter2 = POSTAL_LETTERS[Math.floor(Math.random() * POSTAL_LETTERS.length)];
  return `${prefix}${letter} ${digit}${letter2}${rand(0, 9)}`;
}

function generateClient(): Client {
  const firstName  = pick(FIRST_NAMES);
  const lastName   = pick(LAST_NAMES);
  const company    = pick(COMPANIES);
  const location   = pick(ONTARIO_CITIES);
  const streetNum  = rand(1, 9999);
  const streetName = pick(STREET_NAMES);
  const streetSuf  = pick(STREET_SUFFIXES);
  const langPair   = pick(LANGUAGE_PAIRS);

  const now = new Date().toISOString();

  return {
    client_id:          uuidv4(),
    name:               `${firstName} ${lastName}`,
    email:              `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${company.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}.ca`,
    phone:              `(${rand(416, 647)}) ${rand(200, 999)}-${String(rand(1000, 9999))}`,
    street:             `${streetNum} ${streetName} ${streetSuf}`,
    city:               location.city,
    province:           "ON",
    postal_code:        generatePostalCode(location.postalPrefix),
    company,
    language_pair:      langPair,
    abbreviation:       (firstName[0] + lastName[0]).toUpperCase(),
    has_custom_rates:   false,
    default_tax_exempt: Math.random() < 0.15,
    notes:              "",
    created_at:         now,
    updated_at:         now,
  };
}

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const client = generateClient();
    await createClient(client);
    return NextResponse.json({ data: client }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
