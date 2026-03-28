"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  Loader2,
  ImageIcon,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Fingerprint,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { getHistory } from "@/lib/api";
import type { HistoryItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = () => {
    setLoading(true);
    getHistory()
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const hashGroups = items.reduce<Record<string, HistoryItem[]>>((acc, item) => {
    if (!acc[item.image_hash]) acc[item.image_hash] = [];
    acc[item.image_hash].push(item);
    return acc;
  }, {});

  const verdictIcon = (v: string) => {
    if (v === "PASS") return <ShieldCheck className="w-4 h-4 text-green-400" />;
    if (v === "FAIL") return <ShieldAlert className="w-4 h-4 text-red-400" />;
    return <ShieldQuestion className="w-4 h-4 text-amber-400" />;
  };

  const verdictColor = (v: string) =>
    v === "PASS" ? "text-green-400" : v === "FAIL" ? "text-red-400" : "text-amber-400";

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Analysis History</h1>
                <p className="text-sm text-muted-foreground">
                  {total} analyses stored with consistency verification
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadHistory} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </motion.div>

        {loading && items.length === 0 && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading history...
          </div>
        )}

        {error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="p-4">
              <p className="text-sm text-red-400">{error}</p>
            </CardContent>
          </Card>
        )}

        {!loading && items.length === 0 && !error && (
          <Card>
            <CardContent className="p-12 text-center">
              <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium mb-1">No analyses yet</p>
              <p className="text-xs text-muted-foreground">
                Run your first compliance check on the Analyze page.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && items.length > 0 && (
          <ScrollArea className="max-h-[calc(100vh-200px)]">
            <div className="space-y-3">
              {Object.values(hashGroups).map((group) => {
                const isMultiple = group.length > 1;
                const allSameVerdict = group.every((g) => g.verdict === group[0].verdict);

                return (
                  <motion.div
                    key={group[0].image_hash}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Card className={isMultiple ? "border-blue-500/30" : ""}>
                      {isMultiple && (
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/5 border-b border-blue-500/20">
                          <Fingerprint className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-xs font-medium text-blue-400">
                            Consistency {allSameVerdict ? "verified" : "check"} — analyzed {group.length} times
                            {allSameVerdict ? " with same result" : ""}
                          </span>
                        </div>
                      )}
                      <CardContent className="p-0">
                        <div className={isMultiple ? "divide-y divide-blue-500/10" : ""}>
                          {group.map((item) => (
                            <div key={item.id} className="flex items-center gap-4 p-4 hover:bg-accent/20 transition-colors">
                              <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {item.blob_url ? (
                                  <img
                                    src={item.blob_url}
                                    alt="Analysis"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {verdictIcon(item.verdict)}
                                  <span className={`text-sm font-semibold ${verdictColor(item.verdict)}`}>
                                    {item.verdict}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {item.confidence}%
                                  </span>
                                  <Badge variant="outline" className="text-[10px] ml-auto">
                                    {item.violations_count} violation{item.violations_count !== 1 ? "s" : ""}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  <span>{new Date(item.timestamp).toLocaleString()}</span>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <code className="font-mono text-[10px] opacity-60">
                                        {item.image_hash.slice(0, 12)}...
                                      </code>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs font-mono">{item.image_hash}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                  {item.session_id && (
                                    <a
                                      href={`/analyze?session=${item.session_id}`}
                                      className="flex items-center gap-1 text-primary hover:underline"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      View
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
