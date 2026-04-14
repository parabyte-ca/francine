"use client";

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
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard",                label: "Dashboard",    icon: LayoutDashboard },
  { href: "/dashboard/orders",         label: "Orders",       icon: ClipboardList },
  { href: "/dashboard/customers",      label: "Customers",    icon: Users },
  { href: "/dashboard/scheduling",     label: "Scheduling",   icon: CalendarDays },
  { href: "/dashboard/invoices",       label: "Invoices",     icon: FileText },
  { href: "/dashboard/payments",       label: "Payments",     icon: CreditCard },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 min-h-screen bg-white border-r flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b">
        <span className="text-xl font-bold text-brand-700">Francine</span>
        <span className="ml-1 text-xs bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded font-medium">CRM</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
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
          href="/dashboard/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Settings className="w-4 h-4 text-gray-400" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
