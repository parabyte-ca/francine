"use client";

import { useState } from "react";
import Topbar from "@/components/Topbar";
import {
  Loader2, Settings as SettingsIcon, CheckCircle2, AlertCircle,
  RefreshCw, Trash2, UserPlus, FlaskConical, FileDown, BarChart3,
} from "lucide-react";
import pkg from "@/package.json";

type SetupResult = { message: string; results: Record<string, string> };

export default function SetupPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dev tools state
  const [showEraseModal, setShowEraseModal] = useState(false);
  const [eraseConfirmed, setEraseConfirmed] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseResult, setEraseResult] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedToast, setSeedToast] = useState<string | null>(null);

  // Tax report state
  const currentYear = new Date().getFullYear();
  const [taxFrom, setTaxFrom] = useState(`${currentYear}-01-01`);
  const [taxTo, setTaxTo] = useState(`${currentYear}-12-31`);

  const runSetup = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/setup", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
      } else {
        setResult(json);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const eraseData = async () => {
    setErasing(true);
    setEraseResult(null);
    try {
      const res = await fetch("/api/dev/reset", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setEraseResult(`Error: ${typeof json.error === "string" ? json.error : JSON.stringify(json.error)}`);
      } else {
        setEraseResult(`Cleared: ${json.cleared.join(", ")}`);
      }
    } catch (e: unknown) {
      setEraseResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setErasing(false);
      setShowEraseModal(false);
      setEraseConfirmed(false);
    }
  };

  const seedCustomer = async () => {
    setSeeding(true);
    setSeedToast(null);
    try {
      const res = await fetch("/api/dev/seed-customer", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setSeedToast(`Error: ${typeof json.error === "string" ? json.error : "Seed failed"}`);
      } else {
        setSeedToast(`Added: ${json.data.name} (${json.data.company || json.data.email})`);
      }
    } catch (e: unknown) {
      setSeedToast(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeeding(false);
      setTimeout(() => setSeedToast(null), 4000);
    }
  };

  return (
    <>
      <Topbar title="Settings" subtitle={`Francine CRM v${pkg.version}`} />
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Setup action */}
          <div className="card">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-brand-50 text-brand-700 flex-shrink-0">
                <SettingsIcon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-gray-900">Initialize / Repair Workspace</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Creates missing Google Sheet tabs, provisions the Drive folder for
                  invoice PDFs, and registers/renews the Google Calendar webhook.
                  Safe to re-run any time.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <button onClick={runSetup} disabled={loading} className="btn-primary">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {loading ? "Running setup…" : "Run Setup"}
              </button>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Setup failed</p>
                  <p className="mt-1 font-mono text-xs">{error}</p>
                </div>
              </div>
            )}

            {result && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                <p className="flex items-center gap-2 font-medium text-green-800">
                  <CheckCircle2 className="w-4 h-4" /> {result.message}
                </p>
                <dl className="mt-3 space-y-1 text-xs text-green-900">
                  {Object.entries(result.results).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="font-medium min-w-[10rem]">{key}:</dt>
                      <dd className="font-mono break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {/* Environment info */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">Environment</h2>
              <span className="badge-blue font-mono text-xs">v{pkg.version}</span>
            </div>
            <p className="text-sm text-gray-600">
              Francine stores its data in your Google Workspace. Configure the
              following environment variables on your host:
            </p>
            <ul className="mt-3 space-y-1 text-xs text-gray-700 font-mono">
              <li>GOOGLE_SHEET_ID — spreadsheet used as the database</li>
              <li>GOOGLE_DRIVE_FOLDER_ID — invoice PDF folder (auto-created on setup if missing)</li>
              <li>GOOGLE_CALENDAR_ID — your Google Calendar ID for appointment scheduling (usually your Gmail address, e.g. you@gmail.com). The service account email must be granted &quot;Make changes to events&quot; access on that calendar first. Defaults to the service account&apos;s own calendar (invisible to you) if not set.</li>
              <li>GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY — service account credentials</li>
              <li>AUTH_URL — public HTTPS URL (needed for calendar push webhooks)</li>
              <li>TAX_RATE_PERCENT — Ontario HST rate applied to invoices (default: 13%)</li>
            </ul>
          </div>

          {/* Quick links */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-2">Quick Links</h2>
            <ul className="space-y-1 text-sm">
              <li><a href="/dashboard" className="text-brand-600 hover:underline">Dashboard</a></li>
              <li><a href="/customers" className="text-brand-600 hover:underline">Customers</a></li>
              <li><a href="/orders" className="text-brand-600 hover:underline">Orders</a></li>
              <li><a href="/invoices" className="text-brand-600 hover:underline">Invoices</a></li>
              <li><a href="/api/health" className="text-brand-600 hover:underline" target="_blank" rel="noopener noreferrer">Health check</a></li>
            </ul>
          </div>

          {/* ── Tax Report ──────────────────────────────────────────────────── */}
          <div className="card">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2.5 rounded-lg bg-brand-50 text-brand-700 flex-shrink-0">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Year-End Tax Report</h2>
                <p className="text-sm text-gray-600 mt-0.5">
                  Export a CSV summary of income and HST collected for Ontario tax filing.
                  Excludes draft and void invoices.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="label">From</label>
                <input
                  type="date"
                  value={taxFrom}
                  onChange={(e) => setTaxFrom(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label">To</label>
                <input
                  type="date"
                  value={taxTo}
                  onChange={(e) => setTaxTo(e.target.value)}
                  className="input"
                />
              </div>
              <a
                href={`/api/reports/tax?from=${taxFrom}&to=${taxTo}&format=csv`}
                download
                className="btn-primary no-underline"
              >
                <FileDown className="w-4 h-4" />
                Download CSV
              </a>
            </div>
          </div>

          {/* ── Developer Tools ─────────────────────────────────────────────── */}
          <div className="card border-amber-300 bg-amber-50">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2.5 rounded-lg bg-amber-100 text-amber-700 flex-shrink-0">
                <FlaskConical className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-amber-900">Developer Tools</h2>
                <p className="text-xs text-amber-700 mt-0.5">
                  For testing only — remove before production.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Seed fake client */}
              <div className="p-4 bg-white rounded-lg border border-amber-200">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Add Fake Client</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Each click creates one realistic Canadian client in Ontario and adds
                      it to the Clients sheet.
                    </p>
                  </div>
                  <button
                    onClick={seedCustomer}
                    disabled={seeding}
                    className="btn-secondary text-xs py-1.5 flex-shrink-0"
                  >
                    {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    Add Fake Client
                  </button>
                </div>
                {seedToast && (
                  <p className="mt-2 text-xs text-green-700 font-medium">{seedToast}</p>
                )}
              </div>

              {/* Erase all data */}
              <div className="p-4 bg-white rounded-lg border border-red-200">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-red-800">Erase All Data</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Permanently deletes all rows from every sheet tab (keeps headers and Config).
                      This cannot be undone.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowEraseModal(true)}
                    className="btn-secondary text-xs py-1.5 border-red-300 text-red-700 hover:bg-red-50 flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Erase Data
                  </button>
                </div>
                {eraseResult && (
                  <p className={`mt-2 text-xs font-medium ${eraseResult.startsWith("Error") ? "text-red-700" : "text-green-700"}`}>
                    {eraseResult}
                  </p>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Erase confirmation modal */}
      {showEraseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-red-100">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <h2 className="font-semibold text-gray-900">Erase All Data</h2>
              </div>

              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 space-y-1">
                <p className="font-bold">⚠ This is irreversible.</p>
                <p>
                  All clients, orders, invoices, appointments, line items, and rates
                  will be permanently deleted from your Google Sheet. This cannot be undone.
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={eraseConfirmed}
                  onChange={(e) => setEraseConfirmed(e.target.checked)}
                  className="mt-0.5 rounded"
                />
                <span>I understand this will permanently delete all data and cannot be undone.</span>
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => { setShowEraseModal(false); setEraseConfirmed(false); }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={eraseData}
                  disabled={!eraseConfirmed || erasing}
                  className="btn-primary bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  {erasing && <Loader2 className="w-4 h-4 animate-spin" />}
                  Erase Everything
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
