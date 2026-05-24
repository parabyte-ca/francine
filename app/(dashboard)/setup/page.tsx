"use client";

import { useState, useEffect } from "react";
import Topbar from "@/components/Topbar";
import {
  Loader2, Settings as SettingsIcon, CheckCircle2, AlertCircle,
  RefreshCw, Trash2, UserPlus, FlaskConical, FileDown, BarChart3,
  Database, DollarSign, Pencil, Plus, X, Check,
} from "lucide-react";
import pkg from "@/package.json";

type SetupResult = { message: string; results: Record<string, string> };

interface StandardRate {
  rate_id: string;
  service_type: string;
  unit: string;
  base_price: number;
  minimum_charge: number;
  description: string;
  active: boolean;
  effective_date: string;
}

const DEFAULT_RATES: Omit<StandardRate, "rate_id" | "active" | "effective_date">[] = [
  { service_type: "ASL-English Interpretation < 90 min", unit: "session",  base_price: 230, minimum_charge: 230, description: "< 90 minutes" },
  { service_type: "ASL-English Interpretation 2h",       unit: "session",  base_price: 275, minimum_charge: 275, description: "2 hours" },
  { service_type: "ASL-English Interpretation Half Day", unit: "half-day", base_price: 330, minimum_charge: 330, description: "Half day" },
  { service_type: "ASL-English Interpretation Full Day", unit: "full-day", base_price: 630, minimum_charge: 630, description: "Full day" },
  { service_type: "ASL-English Interpretation Conference", unit: "session", base_price: 800, minimum_charge: 800, description: "Conference" },
  { service_type: "ASL-English Interpretation Custom",   unit: "custom",   base_price: 0,   minimum_charge: 0,   description: "Custom rate" },
];

type EditingRate = {
  rate_id: string;
  service_type: string;
  unit: string;
  base_price: string;
  minimum_charge: string;
  description: string;
};

type NewRate = {
  service_type: string;
  unit: string;
  base_price: string;
  minimum_charge: string;
  description: string;
};

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

  // Email settings state
  const [emailOverride, setEmailOverride] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [resendConfigured, setResendConfigured] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        setEmailOverride(j.data?.invoice_email_override ?? "");
        setGmailConnected(j.data?.gmail_connected ?? false);
        setResendConfigured(j.data?.resend_configured ?? false);
      });
    // Show connection result from OAuth callback
    const params = new URLSearchParams(window.location.search);
    const gmailParam = params.get("gmail");
    if (gmailParam === "connected") setGmailConnected(true);
  }, []);

  const saveEmailOverride = async () => {
    setEmailSaving(true);
    setEmailSaved(false);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_email_override: emailOverride }),
      });
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 3000);
    } finally {
      setEmailSaving(false);
    }
  };

  // Rate management state
  const [rates, setRates] = useState<StandardRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [editingRate, setEditingRate] = useState<EditingRate | null>(null);
  const [rateSaving, setRateSaving] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [addingRate, setAddingRate] = useState(false);
  const [newRate, setNewRate] = useState<NewRate>({ service_type: "", unit: "session", base_price: "", minimum_charge: "", description: "" });
  const [seedingRates, setSeedingRates] = useState(false);

  const fetchRates = async () => {
    setRatesLoading(true);
    try {
      const res = await fetch("/api/rates");
      const json = await res.json();
      setRates(json.data?.standard_rates ?? []);
    } finally {
      setRatesLoading(false);
    }
  };

  useEffect(() => { fetchRates(); }, []);

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

  const startEdit = (rate: StandardRate) => {
    setEditingRate({
      rate_id:        rate.rate_id,
      service_type:   rate.service_type,
      unit:           rate.unit,
      base_price:     String(rate.base_price),
      minimum_charge: String(rate.minimum_charge),
      description:    rate.description,
    });
    setRateError(null);
  };

  const saveEdit = async () => {
    if (!editingRate) return;
    setRateSaving(true);
    setRateError(null);
    try {
      const res = await fetch(`/api/rates/${editingRate.rate_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_type:   editingRate.service_type,
          unit:           editingRate.unit,
          base_price:     Number(editingRate.base_price),
          minimum_charge: Number(editingRate.minimum_charge),
          description:    editingRate.description,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        setRateError(typeof json.error === "string" ? json.error : "Failed to save");
        return;
      }
      setEditingRate(null);
      await fetchRates();
    } finally {
      setRateSaving(false);
    }
  };

  const deactivateRate = async (rate_id: string) => {
    await fetch(`/api/rates/${rate_id}`, { method: "DELETE" });
    await fetchRates();
  };

  const saveNewRate = async () => {
    setRateSaving(true);
    setRateError(null);
    try {
      const res = await fetch("/api/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_type:   newRate.service_type,
          unit:           newRate.unit,
          base_price:     Number(newRate.base_price),
          minimum_charge: Number(newRate.minimum_charge),
          description:    newRate.description,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        setRateError(typeof json.error === "string" ? json.error : "Failed to save");
        return;
      }
      setAddingRate(false);
      setNewRate({ service_type: "", unit: "session", base_price: "", minimum_charge: "", description: "" });
      await fetchRates();
    } finally {
      setRateSaving(false);
    }
  };

  const seedDefaultRates = async () => {
    setSeedingRates(true);
    try {
      for (const r of DEFAULT_RATES) {
        await fetch("/api/rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(r),
        });
      }
      await fetchRates();
    } finally {
      setSeedingRates(false);
    }
  };

  const activeRates = rates.filter((r) => r.active);

  return (
    <>
      <Topbar title="Settings" subtitle={`Francine CRM v${pkg.version}`} />
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Email override */}
          <div className="card space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-brand-50 text-brand-700 flex-shrink-0">
                <FlaskConical className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Test Email Override</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Redirect all invoice emails to these addresses instead of the client&apos;s email.
                  Separate multiple addresses with commas. Leave blank to send to the client normally.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1"
                placeholder="test@example.com, another@example.com"
                value={emailOverride}
                onChange={(e) => setEmailOverride(e.target.value)}
              />
              <button
                onClick={saveEmailOverride}
                disabled={emailSaving}
                className="btn-primary whitespace-nowrap"
              >
                {emailSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : emailSaved ? <Check className="w-4 h-4" /> : null}
                {emailSaved ? "Saved" : "Save"}
              </button>
            </div>
            {emailOverride.trim() && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Override active — invoice emails will go to <strong>{emailOverride}</strong>
              </p>
            )}
          </div>

          {/* Email provider */}
          <div className="card space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-brand-50 text-brand-700 flex-shrink-0">
                <FlaskConical className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Email Provider</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Connect a provider to send invoice emails. Resend (API key) takes priority over Gmail OAuth2.
                </p>
              </div>
            </div>

            {resendConfigured ? (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                Resend configured via <code className="font-mono text-xs">RESEND_API_KEY</code> — emails will use Resend.
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                No Resend key detected. Set <code className="font-mono">RESEND_API_KEY</code> in <code className="font-mono">.env.local</code> for instant setup (resend.com — free tier available).
              </p>
            )}

            <div className="border-t pt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Gmail OAuth2</p>
              {gmailConnected ? (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  Gmail connected — sending as <strong>{process.env.NEXT_PUBLIC_GMAIL_FROM ?? "your Gmail account"}</strong>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Authorise the app to send email via your Google account.
                    Your <code className="font-mono">GOOGLE_CLIENT_ID</code> must have the <code className="font-mono">https://mail.google.com/</code> scope enabled in Google Cloud Console.
                  </p>
                  <a href="/api/settings/gmail-connect" className="btn-secondary text-sm inline-flex">
                    Connect Gmail Account
                  </a>
                </div>
              )}
            </div>
          </div>

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

          {/* ── Rate Management ─────────────────────────────────────────────── */}
          <div className="card">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2.5 rounded-lg bg-brand-50 text-brand-700 flex-shrink-0">
                <DollarSign className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="font-semibold text-gray-900">Rate Management</h2>
                  <div className="flex gap-2">
                    {activeRates.length === 0 && !ratesLoading && (
                      <button
                        onClick={seedDefaultRates}
                        disabled={seedingRates}
                        className="btn-secondary text-xs py-1.5"
                      >
                        {seedingRates ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Restore Defaults
                      </button>
                    )}
                    <button
                      onClick={() => { setAddingRate(true); setRateError(null); }}
                      className="btn-primary text-xs py-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Rate
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mt-0.5">
                  Standard rates used when generating invoices.
                </p>
              </div>
            </div>

            {rateError && (
              <p className="text-xs text-red-600 mb-3">{rateError}</p>
            )}

            {ratesLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading rates…
              </div>
            ) : (
              <div className="space-y-2">
                {activeRates.length === 0 && !addingRate && (
                  <p className="text-sm text-gray-400 py-4 text-center">
                    No rates yet.{" "}
                    <button onClick={seedDefaultRates} className="text-brand-600 hover:underline">
                      Restore defaults
                    </button>
                  </p>
                )}

                {activeRates.map((rate) => (
                  <div key={rate.rate_id} className="border rounded-lg p-3">
                    {editingRate?.rate_id === rate.rate_id ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2">
                            <label className="label text-xs">Label</label>
                            <input
                              type="text"
                              className="input text-sm"
                              value={editingRate.description}
                              onChange={(e) => setEditingRate((p) => p ? { ...p, description: e.target.value } : p)}
                            />
                          </div>
                          <div>
                            <label className="label text-xs">Rate ($)</label>
                            <input
                              type="number"
                              className="input text-sm"
                              min={0}
                              step={0.01}
                              value={editingRate.base_price}
                              onChange={(e) => setEditingRate((p) => p ? { ...p, base_price: e.target.value } : p)}
                            />
                          </div>
                          <div>
                            <label className="label text-xs">Minimum ($)</label>
                            <input
                              type="number"
                              className="input text-sm"
                              min={0}
                              step={0.01}
                              value={editingRate.minimum_charge}
                              onChange={(e) => setEditingRate((p) => p ? { ...p, minimum_charge: e.target.value } : p)}
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingRate(null)} className="btn-secondary text-xs py-1.5">
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                          <button onClick={saveEdit} disabled={rateSaving} className="btn-primary text-xs py-1.5">
                            {rateSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{rate.description || rate.service_type}</p>
                          <p className="text-xs text-gray-500">{rate.unit}</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-900">${rate.base_price.toFixed(2)}</p>
                            {rate.minimum_charge > 0 && (
                              <p className="text-xs text-gray-400">min ${rate.minimum_charge.toFixed(2)}</p>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => startEdit(rate)}
                              className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deactivateRate(rate.rate_id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Remove"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add new rate form */}
                {addingRate && (
                  <div className="border-2 border-dashed border-brand-200 rounded-lg p-3 space-y-3">
                    <p className="text-xs font-medium text-brand-700">New Rate</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="label text-xs">Label</label>
                        <input
                          type="text"
                          className="input text-sm"
                          placeholder="e.g. 2 hours"
                          value={newRate.description}
                          onChange={(e) => setNewRate((p) => ({ ...p, description: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="label text-xs">Rate ($)</label>
                        <input
                          type="number"
                          className="input text-sm"
                          min={0}
                          step={0.01}
                          placeholder="0.00"
                          value={newRate.base_price}
                          onChange={(e) => setNewRate((p) => ({ ...p, base_price: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="label text-xs">Minimum ($)</label>
                        <input
                          type="number"
                          className="input text-sm"
                          min={0}
                          step={0.01}
                          placeholder="0.00"
                          value={newRate.minimum_charge}
                          onChange={(e) => setNewRate((p) => ({ ...p, minimum_charge: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setAddingRate(false)} className="btn-secondary text-xs py-1.5">
                        Cancel
                      </button>
                      <button
                        onClick={saveNewRate}
                        disabled={rateSaving || !newRate.description || !newRate.base_price}
                        className="btn-primary text-xs py-1.5"
                      >
                        {rateSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Add Rate
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Database Backup ─────────────────────────────────────────────── */}
          <div className="card">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2.5 rounded-lg bg-brand-50 text-brand-700 flex-shrink-0">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Database Backup</h2>
                <p className="text-sm text-gray-600 mt-0.5">
                  Download a full JSON export of all your data — clients, events, appointments,
                  invoices, and rates.
                </p>
              </div>
            </div>
            <a href="/api/backup" download className="btn-primary no-underline inline-flex items-center gap-2">
              <FileDown className="w-4 h-4" />
              Download Backup
            </a>
            <p className="mt-3 text-xs text-gray-500">
              <strong>Automatic backups:</strong> Schedule a daily cron job or task to call{" "}
              <code className="font-mono bg-gray-100 px-1 rounded">GET /api/backup</code> and save the file.
              Google Sheets also maintains 30 days of revision history via{" "}
              <em>File → Version History</em>.
            </p>
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
              <li><a href="/customers" className="text-brand-600 hover:underline">Clients</a></li>
              <li><a href="/orders" className="text-brand-600 hover:underline">Events</a></li>
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
                  All clients, events, invoices, appointments, line items, and rates
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
