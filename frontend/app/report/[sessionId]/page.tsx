"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Layers,
  Clock,
  Hash,
  ImageIcon,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Send,
  Printer,
  Download,
  Info,
  Lightbulb,
  Scan,
  BookOpen,
} from "lucide-react";
import { getAnalysis, getChatMessages, streamChatMessage } from "@/lib/api";
import type { ComplianceResult, Violation, PassedDetail, ChatMessage } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const severityConfig: Record<string, { color: string; bg: string; border: string; label: string; weight: number }> = {
  critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Critical", weight: 3 },
  high: { color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", label: "High", weight: 2 },
  medium: { color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", label: "Medium", weight: 1 },
};

const verdictConfig: Record<string, { icon: typeof ShieldCheck; color: string; bg: string; border: string; label: string }> = {
  PASS: { icon: ShieldCheck, color: "text-green-600 dark:text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", label: "Compliant" },
  FAIL: { icon: ShieldAlert, color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", label: "Non-Compliant" },
  WARNING: { icon: ShieldQuestion, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Needs Review" },
};

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedViolations, setExpandedViolations] = useState<Set<number>>(new Set());
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    getAnalysis(sessionId)
      .then((r) => { setResult(r); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (result?.session_id) {
      getChatMessages(result.session_id).then(setChatMessages);
    }
  }, [result?.session_id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const toggleViolation = useCallback((idx: number) => {
    setExpandedViolations((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!result) return;
    setExpandedViolations(new Set(result.violations.map((_, i) => i)));
  }, [result]);

  const collapseAll = useCallback(() => {
    setExpandedViolations(new Set());
  }, []);

  const handleSendChat = () => {
    if (!chatInput.trim() || !result?.session_id || chatStreaming) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatStreaming(true);

    let assistantContent = "";
    setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    streamChatMessage(
      result.session_id,
      userMsg,
      (chunk) => {
        assistantContent += chunk;
        setChatMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantContent };
          return updated;
        });
      },
      () => setChatStreaming(false),
      () => setChatStreaming(false),
    );
  };

  const checksPassedCount = Array.isArray(result?.passed_details) ? result!.passed_details.length : 0;

  const passedByCategory = (result?.passed_details || []).reduce<Record<string, PassedDetail[]>>((acc, pd) => {
    const cat = pd.category || "Content";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pd);
    return acc;
  }, {});

  const violationsByRule = (result?.violations || []).reduce<Record<string, Violation[]>>((acc, v) => {
    const ruleId = v.rule_id || "unknown";
    if (!acc[ruleId]) acc[ruleId] = [];
    acc[ruleId].push(v);
    return acc;
  }, {});

  const severityCounts = (result?.violations || []).reduce<Record<string, number>>((acc, v) => {
    const sev = v.severity || "medium";
    acc[sev] = (acc[sev] || 0) + 1;
    return acc;
  }, {});

  const sortedViolations = [...(result?.violations || [])].sort(
    (a, b) => (severityConfig[b.severity]?.weight || 0) - (severityConfig[a.severity]?.weight || 0)
  );

  const totalChecks = (result?.violations?.length || 0) + checksPassedCount;
  const passRate = totalChecks > 0 ? Math.round((checksPassedCount / totalChecks) * 100) : 0;

  const formatDate = (ts?: string) => {
    if (!ts) return "N/A";
    return new Date(ts).toLocaleString("en-US", {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };

  const reportId = `RPT-${sessionId.slice(0, 8).toUpperCase()}`;

  if (loading) {
    return (
      <div className="min-h-screen p-6 lg:p-8">
        <div className="max-w-5xl mx-auto space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="min-h-screen p-6 lg:p-8">
        <div className="max-w-5xl mx-auto">
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="p-8 text-center">
              <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">Report Not Found</h2>
              <p className="text-sm text-muted-foreground mb-4">{error || "This analysis could not be loaded."}</p>
              <Button variant="outline" onClick={() => router.push("/history")} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back to History
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const vc = verdictConfig[result.verdict] || verdictConfig.WARNING;
  const VIcon = vc.icon;

  return (
    <div className="min-h-screen p-6 lg:p-8 print:p-0">
      <div className="max-w-5xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => router.push("/history")} className="gap-1.5 print:hidden">
                <ArrowLeft className="w-4 h-4" /> History
              </Button>
              <Separator orientation="vertical" className="h-6 print:hidden" />
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-primary/10">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight gradient-text">Compliance Report</h1>
                  <p className="text-xs text-muted-foreground font-mono">{reportId}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className={`${vc.border} overflow-hidden`}>
            <CardContent className="p-0">
              <div className={`${vc.bg} p-6`}>
                <div className="flex flex-col md:flex-row gap-6">
                  {result.image_url && (
                    <div className="w-full md:w-48 h-48 rounded-lg bg-muted/30 overflow-hidden flex-shrink-0 border border-border/50">
                      <img src={result.image_url} alt="Analyzed image" className="w-full h-full object-contain" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 15 }}
                      >
                        <VIcon className={`w-8 h-8 ${vc.color}`} />
                      </motion.div>
                      <div>
                        <h2 className={`text-2xl font-bold ${vc.color}`}>{vc.label}</h2>
                        <p className="text-xs text-muted-foreground">
                          Confidence: <span className="font-semibold">{result.confidence}%</span>
                        </p>
                      </div>
                    </div>
                    {result.summary && (
                      <p className="text-sm text-foreground/80 leading-relaxed mb-4">{result.summary}</p>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <MetaChip icon={Hash} label="Report ID" value={reportId} />
                      <MetaChip icon={Clock} label="Analyzed" value={formatDate(result.timestamp)} />
                      <MetaChip icon={Layers} label="Content Type" value={(result.content_type_detected || "unknown").replace(/_/g, " ")} />
                      <MetaChip icon={ImageIcon} label="Dimensions" value={result.image_width && result.image_height ? `${result.image_width}×${result.image_height}` : "N/A"} />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Total Checks" value={totalChecks} color="text-foreground" />
            <StatCard label="Passed" value={checksPassedCount} color="text-green-600 dark:text-green-400" />
            <StatCard label="Violations" value={result.violations.length} color="text-red-600 dark:text-red-400" />
            <StatCard label="Pass Rate" value={`${passRate}%`} color={passRate >= 80 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"} />
            <StatCard label="Verdict" value={result.verdict} color={vc.color} />
          </div>
        </motion.div>

        {Object.keys(severityCounts).length > 0 && (
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                  Severity Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-3 flex-wrap">
                  {(["critical", "high", "medium"] as const).map((sev) => {
                    const count = severityCounts[sev] || 0;
                    if (count === 0) return null;
                    const sc = severityConfig[sev];
                    return (
                      <div key={sev} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${sc.bg} border ${sc.border}`}>
                        <span className={`text-lg font-bold ${sc.color}`}>{count}</span>
                        <span className={`text-xs font-medium ${sc.color}`}>{sc.label}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Tabs defaultValue="violations" className="w-full">
            <TabsList className="w-full justify-start bg-muted/30 print:hidden">
              <TabsTrigger value="violations" className="gap-1.5">
                <Eye className="w-3.5 h-3.5" />
                Violations ({result.violations.length})
              </TabsTrigger>
              <TabsTrigger value="passed" className="gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Passed ({checksPassedCount})
              </TabsTrigger>
              <TabsTrigger value="details" className="gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Full Details
              </TabsTrigger>
            </TabsList>

            <TabsContent value="violations" className="mt-4">
              {result.violations.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <ShieldCheck className="w-10 h-10 text-green-500 mx-auto mb-3" />
                    <p className="text-sm font-medium">No violations detected</p>
                    <p className="text-xs text-muted-foreground mt-1">This image is compliant with all checked brand rules.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between print:hidden">
                    <p className="text-xs text-muted-foreground">
                      Sorted by severity (critical first)
                    </p>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={expandAll} className="text-xs h-7">Expand All</Button>
                      <Button variant="ghost" size="sm" onClick={collapseAll} className="text-xs h-7">Collapse All</Button>
                    </div>
                  </div>
                  {sortedViolations.map((v, i) => {
                    const origIdx = result.violations.indexOf(v);
                    return (
                      <ViolationCard
                        key={origIdx}
                        violation={v}
                        index={i}
                        expanded={expandedViolations.has(origIdx)}
                        onToggle={() => toggleViolation(origIdx)}
                      />
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="passed" className="mt-4">
              {checksPassedCount === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center">
                    <Info className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-sm font-medium">No passed check details available</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {Object.entries(passedByCategory).map(([category, items]) => (
                    <Card key={category} className="border-green-500/20">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="w-4 h-4" />
                          {category}
                          <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-400 ml-auto">
                            {items.length} passed
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="space-y-1.5">
                          {items.map((pd, i) => (
                            <div key={`${pd.rule_id}-${i}`} className="flex items-start gap-2.5 rounded-md px-3 py-2 bg-green-500/5 border border-green-500/10">
                              <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px] border-green-500/30 text-green-600 dark:text-green-500 font-mono">
                                {pd.rule_id}
                              </Badge>
                              <p className="text-xs text-muted-foreground leading-relaxed">{pd.detail}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="details" className="mt-4">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Scan className="w-4 h-4 text-muted-foreground" />
                      Detection Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <DetailRow label="Content Type" value={(result.content_type_detected || "unknown").replace(/_/g, " ")} />
                      <DetailRow label="Background Type" value={(result.background_type_detected || "unknown").replace(/_/g, " ")} />
                      <DetailRow label="Image Hash" value={result.image_hash || "N/A"} mono />
                      <DetailRow label="Session ID" value={sessionId} mono />
                      <DetailRow label="Image Dimensions" value={result.image_width && result.image_height ? `${result.image_width} × ${result.image_height} px` : "N/A"} />
                      <DetailRow label="Analysis Date" value={formatDate(result.timestamp)} />
                    </div>
                  </CardContent>
                </Card>

                {Object.keys(violationsByRule).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-muted-foreground" />
                        Violations by Rule
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {Object.entries(violationsByRule).map(([ruleId, violations]) => (
                          <div key={ruleId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/20 border border-border/50">
                            <code className="text-xs font-mono font-bold text-primary shrink-0">{ruleId}</code>
                            <span className="text-xs text-muted-foreground flex-1 truncate">
                              {violations[0].rule_text || violations[0].issue}
                            </span>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {violations.length} issue{violations.length !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </motion.div>

        {result.session_id && (
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="print:hidden">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    AI Assistant — Ask About This Report
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowChat(!showChat)}
                    className="text-xs h-7 gap-1"
                  >
                    {showChat ? "Hide" : "Open Chat"}
                    <motion.div animate={{ rotate: showChat ? 90 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronRight className="w-3 h-3" />
                    </motion.div>
                  </Button>
                </div>
              </CardHeader>
              <AnimatePresence>
                {showChat && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <CardContent className="pt-0 pb-4 px-4">
                      <ScrollArea className="h-[300px] mb-3 rounded-lg bg-muted/20 p-3">
                        {chatMessages.length === 0 && !chatStreaming && (
                          <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                              <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                              <p className="text-xs text-muted-foreground">
                                Ask why something was flagged, how to fix a specific violation,
                                <br />or what the brand guidelines require.
                              </p>
                            </div>
                          </div>
                        )}
                        <AnimatePresence initial={false}>
                          {chatMessages.map((msg, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, y: 10, scale: 0.97 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              transition={{ type: "spring", stiffness: 300, damping: 25 }}
                              className={`mb-3 ${msg.role === "user" ? "text-right" : ""}`}
                            >
                              <div
                                className={`inline-block max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm ${
                                  msg.role === "user"
                                    ? "bg-primary text-primary-foreground rounded-br-md"
                                    : "bg-muted/60 text-foreground rounded-bl-md"
                                }`}
                              >
                                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                        {chatStreaming && chatMessages.length > 0 && chatMessages[chatMessages.length - 1].content === "" && (
                          <div className="flex items-center gap-1.5 px-3.5 py-2.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" />
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" />
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot" />
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </ScrollArea>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                          placeholder="Why was rule R-XX flagged? How do I fix the logo placement?"
                          className="flex-1 h-9 px-3.5 text-sm rounded-xl bg-muted/30 border border-border/50 text-foreground placeholder:text-muted-foreground input-premium focus:outline-none"
                        />
                        <Button
                          size="sm"
                          onClick={handleSendChat}
                          disabled={!chatInput.trim() || chatStreaming}
                          className="h-9 w-9 p-0 rounded-xl"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ViolationCard({
  violation: v,
  index,
  expanded,
  onToggle,
}: {
  violation: Violation;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sev = severityConfig[v.severity] || severityConfig.medium;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
    >
      <Card className={`${sev.border} overflow-hidden`}>
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
          className="p-4 cursor-pointer hover:bg-accent/10 transition-colors"
        >
          <div className="flex items-start gap-3">
            <Badge variant="outline" className={`${sev.bg} ${sev.color} ${sev.border} text-[10px] px-2 py-0.5 shrink-0 mt-0.5`}>
              {sev.label}
            </Badge>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs font-mono font-bold text-primary">{v.rule_id}</code>
                {v.bbox && (
                  <Tooltip>
                    <TooltipTrigger>
                      <div className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded font-mono">
                        bbox: {v.bbox.x},{v.bbox.y} {v.bbox.w}×{v.bbox.h}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Bounding box location in the image</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed">{v.issue}</p>
            </div>
            <motion.div
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: 0.2 }}
              className="print:hidden"
            >
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            </motion.div>
          </div>
        </div>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <Separator />
              <div className="p-4 space-y-3 bg-muted/5">
                {v.rule_text && (
                  <div className="flex items-start gap-2.5">
                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Rule Text</p>
                      <p className="text-xs text-foreground/80 leading-relaxed italic">{v.rule_text}</p>
                    </div>
                  </div>
                )}
                {v.evidence && (
                  <div className="flex items-start gap-2.5">
                    <Eye className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Evidence Found</p>
                      <p className="text-xs text-foreground/80 leading-relaxed">{v.evidence}</p>
                    </div>
                  </div>
                )}
                {v.fix_suggestion && (
                  <div className="flex items-start gap-2.5">
                    <Lightbulb className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider mb-0.5">How to Fix</p>
                      <p className="text-xs text-green-700 dark:text-green-300/80 leading-relaxed">{v.fix_suggestion}</p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

function MetaChip({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 bg-background/40 dark:bg-background/20 px-3 py-2 rounded-lg border border-border/50">
      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="text-xs font-medium truncate capitalize">{value}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className={`text-xl font-bold ${color}`}>{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-muted/20 border border-border/30">
      <span className="text-xs text-muted-foreground shrink-0 w-28">{label}</span>
      <span className={`text-xs text-foreground/90 break-all ${mono ? "font-mono text-[11px]" : "capitalize"}`}>{value}</span>
    </div>
  );
}
