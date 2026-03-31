"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  Search,
  Shield,
  Palette,
  Type,
  Image,
  Layers,
  AlertTriangle,
  ChevronRight,
  Hash,
  Inbox,
} from "lucide-react";
import { getRules } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RulesSkeleton } from "@/components/Skeletons";

type RuleItem = {
  id?: string;
  rule?: string;
  severity?: string;
  legal_requirement?: boolean;
  visual_description?: string;
  [key: string]: unknown;
};

const categoryMeta: Record<string, { icon: typeof Shield; color: string; bg: string; border: string }> = {
  regulatory_rules: { icon: Shield, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  logo_rules: { icon: Image, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  logo_donts: { icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
  brand_colors: { icon: Palette, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  color_application_rules: { icon: Palette, color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20" },
  typography_rules: { icon: Type, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  gradient_rules: { icon: Layers, color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20" },
  background_rules: { icon: Image, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
  content_type_rules: { icon: BookOpen, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  content_donts: { icon: AlertTriangle, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20" },
  logo_donts_gradients_backgrounds: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
};

const META_KEYS = new Set(["_meta", "meta", "version", "ai_evaluation_checklist"]);

export default function RulesPage() {
  const [rules, setRules] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  useEffect(() => {
    getRules()
      .then((r) => {
        if (r.rules && typeof r.rules === "object") {
          setRules(r.rules as Record<string, unknown>);
          const keys = Object.keys(r.rules as object).filter((k) => !META_KEYS.has(k));
          setExpandedCats(new Set(keys.slice(0, 3)));
        } else {
          setRules({});
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleCategory = (cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const formatRuleItems = (data: unknown): RuleItem[] => {
    if (Array.isArray(data)) return data as RuleItem[];
    if (typeof data === "object" && data !== null) return Object.values(data) as RuleItem[];
    return [];
  };

  const filterItems = (items: RuleItem[]): RuleItem[] => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item) => {
      const text = JSON.stringify(item).toLowerCase();
      return text.includes(q);
    });
  };

  const totalRules = rules
    ? Object.entries(rules)
        .filter(([k]) => !META_KEYS.has(k))
        .reduce((acc, [, v]) => acc + formatRuleItems(v).length, 0)
    : 0;

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <motion.div
              className="p-2.5 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 animate-glow-pulse"
              whileHover={{ scale: 1.08, rotate: 5 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <BookOpen className="w-5 h-5 text-primary" />
            </motion.div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight gradient-text">Compliance Rules</h1>
              <p className="text-sm text-muted-foreground">
                {totalRules} rules loaded from ZONNIC Brand Design Guidelines
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6"
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules by ID, text, severity..."
              className="w-full h-10 pl-10 pr-4 text-sm rounded-lg bg-card border border-border/50 text-foreground placeholder:text-muted-foreground input-premium focus:outline-none"
            />
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {loading && (
            <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <RulesSkeleton />
            </motion.div>
          )}

          {error && (
            <motion.div key="error" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="border-red-500/30 bg-red-500/5">
                <CardContent className="p-4">
                  <p className="text-sm text-red-400">{error}</p>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {rules && (
          <div className="space-y-3">
            {Object.entries(rules)
              .filter(([k]) => !META_KEYS.has(k))
              .map(([category, data], catIdx) => {
                const items = filterItems(formatRuleItems(data));
                if (search.trim() && items.length === 0) return null;
                const meta = categoryMeta[category] || { icon: Hash, color: "text-muted-foreground", bg: "bg-muted", border: "border-border" };
                const Icon = meta.icon;
                const isExpanded = expandedCats.has(category);
                const label = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

                return (
                  <motion.div
                    key={category}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: catIdx * 0.04, duration: 0.3 }}
                  >
                    <Card className={`${meta.border} overflow-hidden card-hover`}>
                      <button
                        onClick={() => toggleCategory(category)}
                        className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent/20 transition-colors duration-200"
                      >
                        <div className={`p-1.5 rounded-lg ${meta.bg}`}>
                          <Icon className={`w-4 h-4 ${meta.color}`} />
                        </div>
                        <span className="text-sm font-semibold flex-1">{label}</span>
                        <Badge variant="outline" className="text-xs mr-2">
                          {items.length} rule{items.length !== 1 ? "s" : ""}
                        </Badge>
                        <motion.div
                          animate={{ rotate: isExpanded ? 90 : 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </motion.div>
                      </button>
                      <AnimatePresence>
                        {isExpanded && items.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                          >
                            <CardContent className="p-0 border-t border-border/50">
                              <ScrollArea className="max-h-[400px]">
                                <div className="divide-y divide-border/30">
                                  {items.map((item, i) => (
                                    <motion.div
                                      key={i}
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      transition={{ delay: i * 0.02 }}
                                      className="px-4 py-3 hover:bg-accent/15 transition-colors duration-200"
                                    >
                                      {typeof item === "object" && item !== null ? (
                                        <div>
                                          <div className="flex items-center gap-2 mb-1">
                                            {item.id && (
                                              <code className="text-xs font-mono font-bold text-primary">{item.id}</code>
                                            )}
                                            {item.severity && (
                                              <Badge
                                                variant="outline"
                                                className={`text-[10px] px-1.5 ${
                                                  item.severity === "critical"
                                                    ? "text-red-400 border-red-500/30"
                                                    : item.severity === "high"
                                                    ? "text-orange-400 border-orange-500/30"
                                                    : "text-yellow-400 border-yellow-500/30"
                                                }`}
                                              >
                                                {item.severity}
                                              </Badge>
                                            )}
                                            {item.legal_requirement && (
                                              <Badge variant="outline" className="text-[10px] px-1.5 text-red-400 border-red-500/30">
                                                Legal
                                              </Badge>
                                            )}
                                          </div>
                                          {item.rule && <p className="text-sm text-foreground">{item.rule}</p>}
                                          {item.visual_description && (
                                            <p className="text-xs text-muted-foreground mt-1">{item.visual_description}</p>
                                          )}
                                          {!item.rule && !item.id && (
                                            <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                                              {JSON.stringify(item, null, 2)}
                                            </pre>
                                          )}
                                        </div>
                                      ) : (
                                        <p className="text-sm">{String(item)}</p>
                                      )}
                                    </motion.div>
                                  ))}
                                </div>
                              </ScrollArea>
                            </CardContent>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </Card>
                  </motion.div>
                );
              })}
          </div>
        )}

        {rules && totalRules === 0 && !loading && (
          <Card>
            <CardContent className="p-16 text-center">
              <Inbox className="w-10 h-10 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-sm font-medium mb-1">No rules loaded</p>
              <p className="text-xs text-muted-foreground">Check the backend rules configuration.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
