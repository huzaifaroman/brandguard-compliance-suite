"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanLine, Layers, BookOpen, History, Zap } from "lucide-react";

const navItems = [
  { href: "/analyze", label: "Analyze", icon: ScanLine },
  { href: "/batch", label: "Batch", icon: Layers },
  { href: "/rules", label: "Rules", icon: BookOpen },
  { href: "/history", label: "History", icon: History },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed top-0 left-0 h-full flex flex-col border-r"
      style={{
        width: "var(--sidebar-width)",
        background: "rgba(15, 17, 23, 0.95)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        zIndex: 50,
      }}
    >
      <div className="px-5 py-6 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div
            className="rounded-lg p-1.5 flex items-center justify-center"
            style={{ background: "rgba(59, 130, 246, 0.15)", border: "1px solid rgba(59, 130, 246, 0.3)" }}
          >
            <Zap size={16} style={{ color: "#3b82f6" }} />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              ComplianceAI
            </div>
            <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Marketing Engine
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150"
              style={{
                background: isActive ? "rgba(59, 130, 246, 0.12)" : "transparent",
                color: isActive ? "#60a5fa" : "var(--muted-foreground)",
                border: isActive ? "1px solid rgba(59, 130, 246, 0.2)" : "1px solid transparent",
              }}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          AI Compliance Engine v1.0
        </div>
      </div>
    </aside>
  );
}
