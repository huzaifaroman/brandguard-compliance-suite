"use client";

import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";

const Sidebar = dynamic(() => import("@/components/Sidebar"), { ssr: false });
const ExtErrorFilter = dynamic(() => import("@/components/ExtErrorFilter"), { ssr: false });

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ExtErrorFilter />
      <TooltipProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto" style={{ marginLeft: "var(--sidebar-width)" }}>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
        </div>
      </TooltipProvider>
    </>
  );
}
