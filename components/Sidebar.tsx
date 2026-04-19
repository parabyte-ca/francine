"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  CalendarDays,
  FileText,
  CreditCard,
  Settings,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard",   label: "Dashboard",  icon: LayoutDashboard },
  { href: "/orders",      label: "Orders",     icon: ClipboardList },
  { href: "/customers",   label: "Customers",  icon: Users },
  { href: "/scheduling",  label: "Scheduling", icon: CalendarDays },
  { href: "/invoices",    label: "Invoices",   icon: FileText },
  { href: "/payments",    label: "Payments",   icon: CreditCard },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top bar (fixed; layout adds pt-14 md:pt-0 to content) */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-white border-b flex items-center justify-between px-4 z-30">
        <Link href="/dashboard" className="flex items-center">
          <span className="text-lg font-bold text-brand-700">Francine</span>
          <span className="ml-1 text-xs bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded font-medium">CRM</span>
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile drawer backdrop */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar (desktop static, mobile off-canvas) */}
      <aside
        className={clsx(
          "bg-white border-r flex flex-col w-60 z-50",
          "md:static md:min-h-screen",
          "fixed top-0 left-0 h-full transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo / close */}
        <div className="h-16 flex items-center px-6 border-b justify-between">
          <Link href="/dashboard" className="flex items-center">
            <span className="text-xl font-bold text-brand-700">Francine</span>
            <span className="ml-1 text-xs bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded font-medium">CRM</span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="md:hidden p-1.5 text-gray-600 hover:bg-gray-100 rounded"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors group",
                  active
                    ? "bg-brand-50 text-brand-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <Icon className={clsx("w-4 h-4", active ? "text-brand-600" : "text-gray-400 group-hover:text-gray-600")} />
                {label}
                {active && <ChevronRight className="w-3 h-3 ml-auto text-brand-400" />}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: settings */}
        <div className="px-3 py-4 border-t">
          <Link
            href="/setup"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Settings className="w-4 h-4 text-gray-400" />
            Settings
          </Link>
        </div>
      </aside>
    </>
  );
}
