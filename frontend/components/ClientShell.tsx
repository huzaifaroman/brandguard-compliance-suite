"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";

function SidebarSkeleton() {
  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col bg-[oklch(0.15_0.005_285)] border-r border-[oklch(0.28_0.01_285)] z-50"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="p-5 border-b border-[oklch(0.28_0.01_285_/_0.5)]">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-[oklch(0.25_0.01_285)] animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3.5 w-24 rounded bg-[oklch(0.25_0.01_285)] animate-pulse" />
            <div className="h-2.5 w-20 rounded bg-[oklch(0.22_0.005_285)] animate-pulse" />
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <div className="w-[18px] h-[18px] rounded bg-[oklch(0.25_0.01_285)] animate-pulse" />
            <div className="space-y-1">
              <div className="h-3 w-16 rounded bg-[oklch(0.25_0.01_285)] animate-pulse" />
              <div className="h-2.5 w-20 rounded bg-[oklch(0.22_0.005_285)] animate-pulse" />
            </div>
          </div>
        ))}
      </nav>
      <div className="p-4 border-t border-[oklch(0.28_0.01_285_/_0.5)]">
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[oklch(0.25_0.01_285)] animate-pulse" />
              <div className="h-2.5 w-16 rounded bg-[oklch(0.22_0.005_285)] animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

const Sidebar = dynamic(() => import("@/components/Sidebar"), {
  ssr: false,
  loading: () => <SidebarSkeleton />,
});
const ExtErrorFilter = dynamic(() => import("@/components/ExtErrorFilter"), { ssr: false });

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navigating, setNavigating] = useState(false);
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      setNavigating(true);
      prevPathRef.current = pathname;
      const timer = setTimeout(() => setNavigating(false), 100);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  return (
    <>
      <ExtErrorFilter />
      <TooltipProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto" style={{ marginLeft: "var(--sidebar-width)" }}>
            <AnimatePresence>
              {navigating && (
                <motion.div
                  className="fixed top-0 left-0 right-0 z-[100] h-0.5"
                  style={{ marginLeft: "var(--sidebar-width)" }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="h-full bg-primary progress-bar-indeterminate" />
                </motion.div>
              )}
            </AnimatePresence>
            <ErrorBoundary>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </ErrorBoundary>
          </main>
        </div>
      </TooltipProvider>
    </>
  );
}
