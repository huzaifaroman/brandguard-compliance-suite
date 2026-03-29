"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { checkHealth, prefetchRoute } from "@/lib/api";
import type { HealthStatus } from "@/lib/types";
import {
  Scan,
  Layers,
  BookOpen,
  Clock,
  Shield,
  Activity,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const navItems = [
  { href: "/analyze", label: "Analyze", icon: Scan, description: "Single image" },
  { href: "/batch", label: "Batch", icon: Layers, description: "Up to 10 images" },
  { href: "/rules", label: "Rules", icon: BookOpen, description: "Brand guidelines" },
  { href: "/history", label: "History", icon: Clock, description: "Past analyses" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    checkHealth().then(setHealth).catch(() => {});
    const interval = setInterval(() => {
      checkHealth().then(setHealth).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const servicesUp = health
    ? [health.azure_vision_configured, health.azure_openai_configured, health.postgres_configured, health.redis_configured].filter(Boolean).length
    : 0;

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col glass-strong z-50"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="p-5 border-b border-[oklch(1_0_0_/_0.06)]">
        <div className="flex items-center gap-2.5">
          <motion.div
            className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center relative animate-glow-pulse"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Shield className="w-5 h-5 text-primary" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight gradient-text">ComplianceAI</h1>
            <p className="text-[10px] text-muted-foreground tracking-wider uppercase">Marketing Engine</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              className="relative block"
              onMouseEnter={() => prefetchRoute(item.href)}
              onFocus={() => prefetchRoute(item.href)}
            >
              <motion.div
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 group relative z-10 ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                whileHover={{ x: isActive ? 0 : 2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
              >
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-lg bg-primary/8 border border-primary/20 shadow-[0_0_20px_oklch(0.55_0.25_264_/_0.08)]"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    />
                  )}
                </AnimatePresence>
                <Icon className={`w-[18px] h-[18px] relative z-10 transition-colors duration-200 ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
                <div className="flex flex-col relative z-10">
                  <span className="text-[13px] font-medium leading-tight">{item.label}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{item.description}</span>
                </div>
                {isActive && (
                  <motion.div
                    className="ml-auto w-1.5 h-1.5 rounded-full bg-primary relative z-10"
                    layoutId="sidebar-dot"
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  />
                )}
              </motion.div>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-2">
        <ThemeToggle />
      </div>

      <div className="p-4 border-t border-[oklch(1_0_0_/_0.06)]">
        <div className="flex items-center gap-2 mb-2.5">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">System</span>
        </div>
        <div className="space-y-2">
          <AnimatePresence mode="wait">
            {health ? (
              <motion.div
                key="health"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-2"
              >
                <StatusDot label="Vision API" active={health.azure_vision_configured} delay={0} />
                <StatusDot label="GPT-4.1" active={health.azure_openai_configured} delay={0.05} />
                <StatusDot label="Database" active={health.postgres_configured} delay={0.1} />
                <StatusDot label="Cache" active={health.redis_configured} delay={0.15} />
              </motion.div>
            ) : (
              <motion.div key="loading" className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-muted animate-pulse" />
                    <div className="h-2.5 w-16 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="mt-3 pt-3 border-t border-[oklch(1_0_0_/_0.06)]">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">{servicesUp}/4 services active</p>
            <div className="flex gap-0.5">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                    i < servicesUp ? "bg-green-500" : "bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusDot({ label, active, delay }: { label: string; active: boolean; delay: number }) {
  return (
    <motion.div
      className="flex items-center gap-2"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
    >
      <div className="relative">
        <div className={`w-2.5 h-2.5 rounded-full transition-colors duration-500 ${active ? "bg-green-500" : "bg-red-500/70"}`} />
        {active && (
          <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-500/40 animate-ping" style={{ animationDuration: '3s' }} />
        )}
      </div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-[9px] ml-auto ${active ? "text-green-500/70" : "text-red-500/50"}`}>
        {active ? "online" : "offline"}
      </span>
    </motion.div>
  );
}
