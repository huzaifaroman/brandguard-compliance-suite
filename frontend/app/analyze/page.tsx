"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Send,
  ChevronRight,
  Sparkles,
  Zap,
  Eye,
  MessageSquare,
  RotateCcw,
  CheckCircle2,
  Cloud,
  ScanEye,
  Brain,
  FileCheck,
  FileText,
  AlertTriangle,
  Info,
  Hash,
  Clock,
  Layers,
  ImageIcon,
  Scan,
  BookOpen,
  Lightbulb,
  Printer,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { pollAnalysis, getChatMessages, streamChatMessage } from "@/lib/api";
import type { JobStatus } from "@/lib/api";
import type { ComplianceResult, Violation, ChatMessage, PassedDetail, CheckPerformed } from "@/lib/types";
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
const pipelineSteps = [
  { icon: Cloud, label: "Uploading", sublabel: "Cloud storage" },
  { icon: ScanEye, label: "Vision Analysis", sublabel: "Reading elements" },
  { icon: Brain, label: "Brand Detection", sublabel: "Identifying elements" },
  { icon: Scan, label: "Rule Evaluation", sublabel: "62 brand rules" },
  { icon: FileCheck, label: "Building Report", sublabel: "Final results" },
];

const stepToIndex: Record<string, number> = {
  uploading: 0, vision: 1, detecting: 2, llm: 3, evaluating: 3, persisting: 4, done: 4,
};

const SESSION_KEY = "compliance_analyze_session";

function saveSession(result: ComplianceResult, previewUrl: string | null) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      result,
      previewUrl: result.image_url || previewUrl,
      savedAt: Date.now(),
    }));
  } catch {}
}

function loadSession(): { result: ComplianceResult; previewUrl: string | null } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.savedAt > 30 * 60 * 1000) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

export default function AnalyzePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [streamMessage, setStreamMessage] = useState("");
  const [expandedViolations, setExpandedViolations] = useState<Set<number>>(new Set());
  const cancelRef = useRef<{ cancel: () => void } | null>(null);
  const [restoredFromSession, setRestoredFromSession] = useState(false);

  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setResult(saved.result);
      if (saved.previewUrl) setPreview(saved.previewUrl);
      setRestoredFromSession(true);
    }
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    if (preview && !restoredFromSession) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
    setShowChat(false);
    setChatMessages([]);
    setExpandedViolations(new Set());
    setRestoredFromSession(false);
    clearSession();
  }, [preview, restoredFromSession]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: 1,
    maxSize: 20 * 1024 * 1024,
  });

  const handleSubmit = () => {
    if (!file) return;
    if (cancelRef.current) cancelRef.current.cancel();
    setLoading(true);
    setError(null);
    setResult(null);
    setLoadingProgress(5);
    setActiveStep(0);
    setStreamMessage("Starting analysis...");
    setExpandedViolations(new Set());
    setRestoredFromSession(false);

    cancelRef.current = pollAnalysis(
      file,
      prompt || undefined,
      (status: JobStatus) => {
        setLoadingProgress(status.progress);
        setActiveStep(stepToIndex[status.step] ?? 0);
        setStreamMessage(status.message);
      },
      (res) => {
        setLoadingProgress(100);
        setActiveStep(4);
        setStreamMessage("Analysis complete");
        saveSession(res, preview);
        setTimeout(() => {
          setResult(res);
          setLoading(false);
          setLoadingProgress(0);
          setActiveStep(0);
          setStreamMessage("");
          cancelRef.current = null;
          setTimeout(() => {
            reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }, 500);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
        setLoadingProgress(0);
        setActiveStep(0);
        setStreamMessage("");
        cancelRef.current = null;
      },
    );
  };

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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (result?.session_id && showChat && chatMessages.length === 0) {
      getChatMessages(result.session_id).then((msgs) => {
        if (msgs.length > 0) setChatMessages(msgs);
      });
    }
  }, [showChat, result?.session_id]);

  useEffect(() => {
    return () => {
      if (cancelRef.current) { cancelRef.current.cancel(); cancelRef.current = null; }
    };
  }, []);

  const handleReset = () => {
    if (cancelRef.current) { cancelRef.current.cancel(); cancelRef.current = null; }
    if (preview && !restoredFromSession) URL.revokeObjectURL(preview);
    clearSession();
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setLoading(false);
    setPrompt("");
    setShowChat(false);
    setRestoredFromSession(false);
    setChatMessages([]);
    setExpandedViolations(new Set());
    setLoadingProgress(0);
    setActiveStep(0);
    setStreamMessage("");
  };

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

  const allPassedDetails = result?.passed_details || [];
  const passedDetails = allPassedDetails.filter(p => p.status !== "not_applicable");
  const naDetails = allPassedDetails.filter(p => p.status === "not_applicable");
  const violationCount = result?.violations?.length || 0;
  const passedCount = passedDetails.length;
  const naCount = naDetails.length;
  const totalRules = violationCount + passedCount + naCount;
  const applicableRules = violationCount + passedCount;
  const passRate = applicableRules > 0 ? Math.round((passedCount / applicableRules) * 100) : 0;

  const passedByCategory = passedDetails.reduce<Record<string, PassedDetail[]>>((acc, pd) => {
    const cat = pd.category || "Content";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pd);
    return acc;
  }, {});

  const naByCategory = naDetails.reduce<Record<string, PassedDetail[]>>((acc, pd) => {
    const cat = pd.category || "Content";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pd);
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

  const checksPerformed = result?.checks_performed || [];

  const formatDate = (ts?: string) => {
    if (!ts) return new Date().toLocaleString("en-US", {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
    return new Date(ts).toLocaleString("en-US", {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };

  const reportId = result?.session_id ? `RPT-${result.session_id.slice(0, 8).toUpperCase()}` : "";

  const vc = result ? (verdictConfig[result.verdict] || verdictConfig.WARNING) : null;

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl bg-primary/10 animate-glow-pulse">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight gradient-text">Analyze Image</h1>
              <p className="text-sm text-muted-foreground">
                Upload a marketing asset for AI-powered compliance review
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          layout
          className={`${result ? "" : "max-w-2xl mx-auto"} space-y-4`}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="overflow-hidden glass-card">
            <CardContent className="p-0">
              <div
                {...getRootProps()}
                className={`relative cursor-pointer transition-all duration-300 ${
                  isDragActive ? "ring-2 ring-primary/50 bg-primary/5" : ""
                }`}
              >
                <input {...getInputProps()} />
                {preview ? (
                  <div className="relative group">
                    <div className="relative overflow-hidden bg-black/20">
                      <motion.img
                        src={preview}
                        alt="Preview"
                        className={`w-full object-contain mx-auto ${result ? "max-h-[300px]" : "max-h-[400px]"}`}
                        initial={{ opacity: 0, scale: 1.02 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4 }}
                      />
                      {loading && (
                        <motion.div
                          className="absolute inset-0 bg-black/40 flex items-center justify-center"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          <div className="relative w-16 h-16">
                            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" style={{ animationDuration: '1s' }} />
                            <div className="absolute inset-2 rounded-full border-2 border-transparent border-t-primary/50 animate-spin" style={{ animationDuration: '1.5s', animationDirection: 'reverse' }} />
                          </div>
                        </motion.div>
                      )}
                      {result && result.violations.length > 0 && (
                        <svg
                          className="absolute inset-0 w-full h-full pointer-events-none"
                          viewBox={`0 0 ${result.image_width || 1000} ${result.image_height || 1000}`}
                          preserveAspectRatio="xMidYMid meet"
                        >
                          {result.violations.map((v, i) =>
                            v.bbox ? (
                              <g key={i}>
                                <motion.rect
                                  x={v.bbox.x}
                                  y={v.bbox.y}
                                  width={v.bbox.w}
                                  height={v.bbox.h}
                                  fill="none"
                                  stroke={
                                    v.severity === "critical"
                                      ? "#ef4444"
                                      : v.severity === "high"
                                      ? "#f97316"
                                      : "#eab308"
                                  }
                                  strokeWidth={2}
                                  strokeDasharray="6 3"
                                  initial={{ opacity: 0, pathLength: 0 }}
                                  animate={{ opacity: 1, pathLength: 1 }}
                                  transition={{ delay: i * 0.15, duration: 0.5 }}
                                />
                                <text
                                  x={v.bbox.x + 4}
                                  y={v.bbox.y - 6}
                                  fill="#fff"
                                  fontSize="12"
                                  fontWeight="bold"
                                  className="drop-shadow-lg"
                                >
                                  {v.rule_id}
                                </text>
                              </g>
                            ) : null
                          )}
                        </svg>
                      )}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                      <p className="text-xs text-white/80 truncate">{file?.name}</p>
                    </div>
                  </div>
                ) : (
                  <motion.div
                    className={`p-14 text-center transition-all duration-300 ${isDragActive ? "bg-primary/5" : ""}`}
                  >
                    <motion.div
                      animate={isDragActive ? { scale: 1.15, y: -8 } : { scale: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                      className="inline-flex p-5 rounded-2xl bg-primary/5 mb-5"
                    >
                      <Upload className="w-8 h-8 text-primary/50" />
                    </motion.div>
                    <p className="text-sm font-medium mb-1.5">
                      {isDragActive ? "Release to upload" : "Drop image or click to browse"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PNG, JPG, WEBP up to 20MB
                    </p>
                  </motion.div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            {result && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                <Button variant="outline" size="sm" onClick={handleReset} className="h-10 px-4 gap-2">
                  <RotateCcw className="w-3.5 h-3.5" />
                  New
                </Button>
              </motion.div>
            )}
            <Button
              onClick={handleSubmit}
              disabled={!file || loading}
              className="h-10 px-6 gap-2 btn-glow"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {loading ? "Analyzing" : "Analyze"}
            </Button>
          </div>
        </motion.div>

        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="max-w-2xl mx-auto"
            >
              <Card className="border-primary/20 overflow-hidden">
                <CardContent className="p-6">
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-muted-foreground">{streamMessage}</span>
                      <span className="text-xs font-mono text-muted-foreground">{loadingProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${loadingProgress}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {pipelineSteps.map((step, i) => {
                      const Icon = step.icon;
                      const isActive = i === activeStep;
                      const isDone = i < activeStep || loadingProgress === 100;
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.08, duration: 0.3 }}
                          className={`flex flex-col items-center gap-1.5 rounded-xl p-2.5 transition-all duration-500 ${
                            isActive
                              ? "bg-primary/10 ring-1 ring-primary/30 shadow-lg shadow-primary/10"
                              : isDone
                              ? "bg-green-500/5 ring-1 ring-green-500/20"
                              : "bg-muted/30 opacity-40"
                          }`}
                        >
                          <div className="relative flex items-center justify-center w-8 h-8">
                            {isActive && (
                              <motion.div
                                className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary"
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                              />
                            )}
                            {isActive && (
                              <motion.div
                                className="absolute inset-[-2px] rounded-full border-2 border-transparent border-b-primary/30"
                                animate={{ rotate: -360 }}
                                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                              />
                            )}
                            {isDone && (
                              <motion.div
                                className="absolute inset-0 rounded-full bg-green-500/10"
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: "spring", stiffness: 500, damping: 25 }}
                              />
                            )}
                            <motion.div
                              animate={isActive ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                              transition={isActive ? { repeat: Infinity, duration: 2, ease: "easeInOut" } : {}}
                            >
                              <Icon className={`w-4 h-4 relative z-10 ${
                                isActive ? "text-primary" : isDone ? "text-green-500" : "text-muted-foreground"
                              }`} />
                            </motion.div>
                            {isDone && (
                              <motion.div
                                className="absolute -bottom-0.5 -right-0.5 z-20"
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.15 }}
                              >
                                <CheckCircle2 className="w-3 h-3 text-green-500 fill-green-500/20" />
                              </motion.div>
                            )}
                          </div>
                          <span className={`text-[10px] font-medium text-center leading-tight ${
                            isActive ? "text-primary" : isDone ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                          }`}>
                            {step.label}
                          </span>
                          <span className="text-[9px] text-muted-foreground text-center leading-tight">{step.sublabel}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <Card className="border-red-500/30 bg-red-500/5">
                <CardContent className="p-4 flex items-center justify-between">
                  <p className="text-sm text-red-400">{error}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSubmit}
                    disabled={!file}
                    className="text-red-400 hover:text-red-300 h-7 text-xs gap-1.5"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {result && vc && (
            <motion.div
              ref={reportRef}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-6"
            >
              <Separator className="my-2" />

              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-primary/10">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight gradient-text">Compliance Report</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground font-mono">{reportId}</p>
                      {result.cached && (
                        <Badge variant="outline" className="text-blue-400 border-blue-500/30 text-[10px] gap-1">
                          <Zap className="w-2.5 h-2.5" /> Cached
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/report/${result.session_id}`}>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Full Report
                    </Button>
                  </Link>
                  <Button variant="outline" size="sm" onClick={() => window.print()} className="h-8 text-xs gap-1.5">
                    <Printer className="w-3.5 h-3.5" /> Print
                  </Button>
                </div>
              </div>

              <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <Card className={`${vc.border} overflow-hidden`}>
                  <CardContent className="p-0">
                    <div className={`${vc.bg} p-6`}>
                      <div className="flex items-start gap-4">
                        <motion.div
                          initial={{ scale: 0, rotate: -180 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: "spring", stiffness: 400, damping: 15 }}
                          className="shrink-0"
                        >
                          {(() => { const VIcon = vc.icon; return <VIcon className={`w-10 h-10 ${vc.color}`} />; })()}
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className={`text-2xl font-bold ${vc.color}`}>{vc.label}</h3>
                            <span className={`text-sm font-semibold ${vc.color}`}>{result.confidence}%</span>
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
                  <StatCard label="Passed" value={passedCount} color="text-green-600 dark:text-green-400" />
                  <StatCard label="Failed" value={violationCount} color="text-red-600 dark:text-red-400" />
                  <StatCard label="Not Applicable" value={naCount} color="text-muted-foreground" />
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
                  <TabsList className="w-full justify-start bg-muted/30">
                    <TabsTrigger value="violations" className="gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      Violations ({result.violations.length})
                    </TabsTrigger>
                    <TabsTrigger value="passed" className="gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Passed ({passedCount})
                    </TabsTrigger>
                    {naCount > 0 && (
                      <TabsTrigger value="na" className="gap-1.5">
                        <Info className="w-3.5 h-3.5" />
                        Not Applicable ({naCount})
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="details" className="gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      Full Details
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="violations" className="mt-4">
                    <div className="flex items-start gap-2.5 rounded-lg px-4 py-3 mb-4 bg-red-500/5 border border-red-500/15">
                      <Info className="w-4 h-4 text-red-500/70 mt-0.5 shrink-0" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        These are brand rules that the image does not comply with. Each violation includes what was found, why it fails, and a suggested fix.
                      </p>
                    </div>
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
                        <div className="flex items-center justify-between">
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
                    <div className="flex items-start gap-2.5 rounded-lg px-4 py-3 mb-4 bg-green-500/5 border border-green-500/15">
                      <Info className="w-4 h-4 text-green-500/70 mt-0.5 shrink-0" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        These are brand rules that the image fully complies with. Each rule was checked and confirmed to be met.
                      </p>
                    </div>
                    {passedCount === 0 ? (
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

                  {naCount > 0 && (
                    <TabsContent value="na" className="mt-4">
                      <div className="flex items-start gap-2.5 rounded-lg px-4 py-3 mb-4 bg-amber-500/5 border border-amber-500/15">
                        <Info className="w-4 h-4 text-amber-500/70 mt-0.5 shrink-0" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          These rules don&apos;t apply to this particular image. For example, rules about dark backgrounds won&apos;t apply to a light background image, or educational content rules won&apos;t apply to a flavour-led design. They are excluded from the pass rate calculation.
                        </p>
                      </div>
                      <div className="space-y-4">
                        {Object.entries(naByCategory).map(([category, items]) => (
                          <Card key={category} className="border-muted-foreground/20">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                                <Info className="w-4 h-4" />
                                {category}
                                <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground ml-auto">
                                  {items.length} not applicable
                                </Badge>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0">
                              <div className="space-y-1.5">
                                {items.map((pd, i) => (
                                  <div key={`${pd.rule_id}-${i}`} className="flex items-start gap-2.5 rounded-md px-3 py-2 bg-muted/30 border border-muted-foreground/10">
                                    <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px] border-muted-foreground/30 text-muted-foreground font-mono">
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
                    </TabsContent>
                  )}

                  {checksPerformed.length > 0 && (
                    <TabsContent value="checks" className="mt-4">
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground mb-3">
                          All {checksPerformed.length} checks from the evaluation checklist
                        </p>
                        {checksPerformed.map((check) => {
                          const statusColors = {
                            pass: { bg: "bg-green-500/10", border: "border-green-500/20", text: "text-green-600 dark:text-green-400", label: "Pass" },
                            fail: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-600 dark:text-red-400", label: "Fail" },
                            not_applicable: { bg: "bg-gray-500/10", border: "border-gray-500/20", text: "text-muted-foreground", label: "N/A" },
                          };
                          const sc = statusColors[check.status] || statusColors.not_applicable;
                          return (
                            <div key={check.check_id} className={`px-4 py-3 rounded-lg ${sc.bg} border ${sc.border}`}>
                              <div className="flex items-center gap-3 mb-1">
                                <code className="text-xs font-mono font-bold text-primary">{check.check_id}</code>
                                <span className="text-sm font-medium flex-1">{check.check_name}</span>
                                <Badge variant="outline" className={`text-[10px] ${sc.text} border-current`}>{sc.label}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed">{check.detail}</p>
                            </div>
                          );
                        })}
                      </div>
                    </TabsContent>
                  )}

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
                            <DetailRow label="Session ID" value={result.session_id || "N/A"} mono />
                            <DetailRow label="Image Dimensions" value={result.image_width && result.image_height ? `${result.image_width} × ${result.image_height} px` : "N/A"} />
                            <DetailRow label="Analysis Date" value={formatDate(result.timestamp)} />
                          </div>
                        </CardContent>
                      </Card>

                      {Object.keys(severityCounts).length > 0 && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <BookOpen className="w-4 h-4 text-muted-foreground" />
                              Violations by Rule
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="space-y-2">
                              {Object.entries(
                                (result.violations || []).reduce<Record<string, Violation[]>>((acc, v) => {
                                  const ruleId = v.rule_id || "unknown";
                                  if (!acc[ruleId]) acc[ruleId] = [];
                                  acc[ruleId].push(v);
                                  return acc;
                                }, {})
                              ).map(([ruleId, violations]) => (
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
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
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
            </motion.div>
          )}
        </AnimatePresence>
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
