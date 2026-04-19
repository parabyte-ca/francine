"use client";

import { useState } from "react";
import Topbar from "@/components/Topbar";
import { Loader2, Settings as SettingsIcon, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

type SetupResult = { message: string; results: Record<string, string> };

export default function SetupPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <Topbar title="Settings" subtitle="Francine setup & diagnostics" />
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
            <h2 className="font-semibold text-gray-900 mb-3">Environment</h2>
            <p className="text-sm text-gray-600">
              Francine stores its data in your Google Workspace. Configure the
              following environment variables on your host:
            </p>
            <ul className="mt-3 space-y-1 text-xs text-gray-700 font-mono">
              <li>GOOGLE_SHEET_ID — spreadsheet used as the database</li>
              <li>GOOGLE_DRIVE_FOLDER_ID — invoice PDF folder (auto-created on setup if missing)</li>
              <li>GOOGLE_CALENDAR_ID — calendar for appointment scheduling</li>
              <li>GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY — service account credentials</li>
              <li>AUTH_URL — public HTTPS URL (needed for calendar push webhooks)</li>
              <li>TAX_RATE_PERCENT — default tax rate applied to new invoices</li>
            </ul>
          </div>

          {/* Navigation back */}
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
        </div>
      </div>
    </>
  );
}
