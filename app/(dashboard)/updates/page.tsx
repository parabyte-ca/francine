import type { Metadata } from "next";
import Topbar from "@/components/Topbar";
import UpdatesPanel from "./UpdatesPanel";

export const metadata: Metadata = { title: "Updates" };

export default function UpdatesPage() {
  return (
    <>
      <Topbar title="Updates" subtitle="New releases and server upgrades" />
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
        <UpdatesPanel />
      </div>
    </>
  );
}
