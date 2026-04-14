"use client";

import { signOut } from "next-auth/react";
import { Bell, LogOut, User } from "lucide-react";

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function Topbar({ title, subtitle, actions }: TopbarProps) {
  return (
    <header className="h-16 bg-white border-b flex items-center px-6 gap-4">
      <div className="flex-1">
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2">
        {actions}

        <button className="btn-ghost" title="Notifications">
          <Bell className="w-4 h-4" />
        </button>

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="btn-ghost text-gray-500"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
