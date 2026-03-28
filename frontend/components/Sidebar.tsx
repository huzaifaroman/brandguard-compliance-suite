"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { checkHealth } from "@/lib/api";
import type { HealthStatus } from "@/lib/types";
import {
  Scan,
  Layers,
  BookOpen,
  Clock,
  Shield,
  Activity,
  CircleDot,
} from "lucide-react";

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
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-foreground">ComplianceAI</h1>
            <p className="text-[10px] text-muted-foreground tracking-wider uppercase">Marketing Engine</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className={`w-[18px] h-[18px] ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
              <div className="flex flex-col">
                <span className="text-[13px] font-medium leading-tight">{item.label}</span>
                <span className="text-[10px] text-muted-foreground leading-tight">{item.description}</span>
              </div>
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">System</span>
        </div>
        <div className="space-y-1.5">
          {health ? (
            <>
              <StatusDot label="Vision API" active={health.azure_vision_configured} />
              <StatusDot label="GPT-4.1" active={health.azure_openai_configured} />
              <StatusDot label="Database" active={health.postgres_configured} />
              <StatusDot label="Cache" active={health.redis_configured} />
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">Connecting...</p>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground">{servicesUp}/4 services active</p>
        </div>
      </div>
    </aside>
  );
}

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <CircleDot className={`w-3 h-3 ${active ? "text-green-500" : "text-red-500"}`} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
