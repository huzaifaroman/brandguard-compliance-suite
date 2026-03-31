"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Loader2,
  Layers,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  X,
  RotateCcw,
  Download,
  FileText,
  CheckCircle2,
  Cloud,
  ScanEye,
  Brain,
  Scan,
  FileCheck,
  ScanLine,
  ImagePlus,
  CircleSlash,
  ExternalLink,
  AlertTriangle,
  Eye,
  Lightbulb,
  BookOpen,
  Info,
  Hash,
  Clock,
  Image as ImageIcon,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { batchAnalyze } from "@/lib/api";
import type { BatchResult, BatchImageResult, Violation, PassedDetail } from "@/lib/types";
import { getFriendlyName } from "@/lib/rule-names";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const MAX_FILES = 10;
const DONUT_COLORS = { passed: "#22c55e", failed: "#ef4444", warnings: "#f59e0b" };
const BATCH_SESSION_KEY = "compliance_batch_session";

function saveBatchSession(result: BatchResult) {
  try {
    sessionStorage.setItem(BATCH_SESSION_KEY, JSON.stringify({ result, savedAt: Date.now() }));
  } catch {}
}

function loadBatchSession(): BatchResult | null {
  try {
    const raw = sessionStorage.getItem(BATCH_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.savedAt > 60 * 60 * 1000) {
      sessionStorage.removeItem(BATCH_SESSION_KEY);
      return null;
    }
    return data.result;
  } catch {
    return null;
  }
}

function clearBatchSession() {
  try { sessionStorage.removeItem(BATCH_SESSION_KEY); } catch {}
}

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

const batchPipelineSteps = [
  { icon: Cloud, label: "Uploading", sublabel: "Cloud storage" },
  { icon: ScanEye, label: "Vision Analysis", sublabel: "Reading elements" },
  { icon: Brain, label: "Rule Evaluation", sublabel: "Checking compliance" },
  { icon: Scan, label: "Cross-Validation", sublabel: "Verifying results" },
  { icon: FileCheck, label: "Building Report", sublabel: "Final results" },
];

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);

  const onDrop = useCallback(
    (accepted: File[]) => {
      previews.forEach((url) => URL.revokeObjectURL(url));
      const combined = [...files, ...accepted].slice(0, MAX_FILES);
      setFiles(combined);
      setPreviews(combined.map((f) => URL.createObjectURL(f)));
      setResult(null);
      setError(null);
    },
    [files, previews]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: MAX_FILES,
  });

  const removeFile = (i: number) => {
    URL.revokeObjectURL(previews[i]);
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
    setPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  useEffect(() => {
    const saved = loadBatchSession();
    if (saved) setResult(saved);
    return () => { previews.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const blob = items[i].getAsFile();
          if (blob) {
            const ext = blob.type.split("/")[1] || "png";
            imageFiles.push(new File([blob], `pasted-image-${Date.now()}-${i}.${ext}`, { type: blob.type }));
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        onDrop(imageFiles);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onDrop]);

  const stepMap: Record<string, number> = {
    uploading: 0, vision: 1, evaluating: 2, cross_validation: 3, building_report: 4, done: 4,
  };

  const handleSubmit = async () => {
    if (!files.length) return;
    setLoading(true);
    setError(null);
    setBatchProgress(5);
    setActiveStep(0);
    try {
      const res = await batchAnalyze(files, (completed, total, step) => {
        const pct = Math.max(5, Math.min(95, (completed / total) * 90 + 5));
        setBatchProgress(pct);
        setActiveStep(stepMap[step] ?? 1);
      });
      setBatchProgress(100);
      setActiveStep(batchPipelineSteps.length - 1);
      await new Promise((r) => setTimeout(r, 400));
      setResult(res);
      saveBatchSession(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch analysis failed");
    } finally {
      setLoading(false);
      setBatchProgress(0);
      setActiveStep(0);
    }
  };

  const toggleRow = (i: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const handleReset = () => {
    previews.forEach((p) => URL.revokeObjectURL(p));
    setResult(null);
    setFiles([]);
    setPreviews([]);
    setExpandedRows(new Set());
    clearBatchSession();
  };

  const exportCSV = () => {
    if (!result) return;
    const headers = ["Image", "Verdict", "Confidence", "Violations", "Checks", "Issues"];
    const rows = result.results.map((r) => [
      r.image_name,
      r.verdict,
      String(r.confidence),
      String(r.violations.length),
      r.violations.map((v) => getFriendlyName(v.rule_id)).join("; "),
      r.violations.map((v) => v.issue).join("; "),
    ]);
    const csv = [headers, ...rows].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-batch-${result.batch_id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    if (!result) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Compliance Batch Report", 14, 20);
    doc.setFontSize(10);
    doc.text(`Batch ID: ${result.batch_id}`, 14, 30);
    doc.text(`Total: ${result.total_images} | Passed: ${result.summary.passed} | Failed: ${result.summary.failed} | Warnings: ${result.summary.warnings}`, 14, 38);

    let y = 50;
    result.results.forEach((r, i) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.text(`${i + 1}. ${r.image_name} — ${r.verdict} (${r.confidence}%)`, 14, y);
      y += 8;
      if (r.violations.length > 0) {
        doc.setFontSize(9);
        r.violations.forEach((v) => {
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text(`  ${getFriendlyName(v.rule_id)} (${v.severity}): ${v.issue}`, 18, y);
          y += 6;
          if (v.fix_suggestion) {
            doc.text(`    Fix: ${v.fix_suggestion}`, 22, y);
            y += 6;
          }
        });
      }
      y += 4;
    });
    doc.save(`compliance-batch-${result.batch_id.slice(0, 8)}.pdf`);
  };

  const donutData = result
    ? [
        { name: "Passed", value: result.summary.passed, color: DONUT_COLORS.passed },
        { name: "Failed", value: result.summary.failed, color: DONUT_COLORS.failed },
        { name: "Warnings", value: result.summary.warnings, color: DONUT_COLORS.warnings },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <motion.div
              className="p-2.5 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 animate-glow-pulse"
              whileHover={{ scale: 1.08, rotate: 5 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Layers className="w-5 h-5 text-primary" />
            </motion.div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight gradient-text">Batch Scan</h1>
              <p className="text-sm text-muted-foreground">
                Upload up to {MAX_FILES} images for parallel compliance checking
              </p>
            </div>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-5"
            >
              <Card className="overflow-hidden card-hover border-dashed border-2 border-border/50 hover:border-primary/30 transition-colors duration-300">
                <CardContent className="p-0">
                  <div
                    {...getRootProps()}
                    className={`p-12 text-center cursor-pointer transition-all duration-300 ${
                      isDragActive ? "bg-primary/5 border-primary/30" : "hover:bg-accent/5"
                    }`}
                  >
                    <input {...getInputProps()} />
                    <motion.div
                      animate={isDragActive ? { scale: 1.05, y: -5 } : { scale: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    >
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                        <ImagePlus className="w-7 h-7 text-primary" />
                      </div>
                      <p className="text-sm font-medium text-foreground/80 mb-1">
                        {isDragActive ? "Drop images here" : "Drop images, click to browse, or paste"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PNG, JPG, WEBP up to 20MB &mdash; Ctrl+V / &#8984;V to paste from clipboard
                      </p>
                      <p className="text-xs text-muted-foreground mt-2 font-medium">
                        {files.length}/{MAX_FILES} <span className="font-normal">selected</span>
                      </p>
                    </motion.div>
                  </div>
                </CardContent>
              </Card>

              <AnimatePresence>
                {files.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {files.map((f, i) => (
                        <motion.div
                          key={`${f.name}-${i}`}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className="relative group"
                        >
                          <Card className="overflow-hidden card-hover">
                            <div className="aspect-square relative bg-muted/20">
                              <img
                                src={previews[i]}
                                alt={f.name}
                                className="w-full h-full object-cover"
                              />
                              <button
                                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3.5 h-3.5 text-white" />
                              </button>
                            </div>
                            <div className="p-2">
                              <p className="text-[11px] text-muted-foreground truncate">{f.name}</p>
                            </div>
                          </Card>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {loading && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <Card className="border-primary/20 bg-primary/5">
                      <CardContent className="p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground/80">
                            Analyzing {files.length} image{files.length !== 1 ? "s" : ""}...
                          </p>
                          <span className="text-sm font-bold text-primary tabular-nums">{Math.round(batchProgress)}%</span>
                        </div>
                        <Progress value={batchProgress} className="h-2" />
                        <div className="flex items-center justify-between pt-1">
                          {batchPipelineSteps.map((step, idx) => {
                            const isActive = idx === activeStep;
                            const isDone = idx < activeStep;
                            const Icon = step.icon;
                            return (
                              <motion.div
                                key={step.label}
                                className="flex flex-col items-center gap-1.5"
                                animate={{ opacity: isActive || isDone ? 1 : 0.4 }}
                              >
                                <div className="relative w-8 h-8 rounded-full bg-muted/30 flex items-center justify-center">
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
                                      initial={{ scale: 0 }}
                                      animate={{ scale: 1 }}
                                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 flex items-center justify-center z-20"
                                    >
                                      <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                                    </motion.div>
                                  )}
                                </div>
                                <div className="text-center">
                                  <p className={`text-[11px] font-medium leading-tight ${
                                    isActive ? "text-primary" : isDone ? "text-green-500" : "text-muted-foreground"
                                  }`}>{step.label}</p>
                                  <p className="text-[9px] text-muted-foreground mt-0.5">{step.sublabel}</p>
                                </div>
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
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Card className="border-red-500/30 bg-red-500/5">
                      <CardContent className="p-4 flex items-center justify-between">
                        <p className="text-sm text-red-400">{error}</p>
                        <Button variant="ghost" size="sm" onClick={handleSubmit} className="text-red-400 h-7 text-xs gap-1.5">
                          <RotateCcw className="w-3 h-3" /> Retry
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-end">
                <Button
                  onClick={handleSubmit}
                  disabled={!files.length || loading}
                  size="lg"
                  className="gap-2.5 btn-glow px-6 h-11 text-sm font-semibold"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ScanLine className="w-4 h-4" />
                  )}
                  {loading ? `Analyzing ${files.length} image${files.length !== 1 ? "s" : ""}...` : `Review ${files.length} Image${files.length !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
                  <Card className="md:row-span-1">
                    <CardContent className="p-4 flex items-center justify-center">
                      <div className="w-[140px] h-[140px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={donutData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={3} dataKey="value" strokeWidth={0}>
                              {donutData.map((entry, idx) => (
                                <Cell key={idx} fill={entry.color} />
                              ))}
                            </Pie>
                            <RechartsTooltip
                              contentStyle={{ background: "rgba(23,23,30,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }}
                              itemStyle={{ color: "#e5e5e5" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <p className="text-xl font-bold">{result.total_images}</p>
                            <p className="text-[10px] text-muted-foreground">images</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
                {[
                  { label: "Passed", count: result.summary.passed, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", icon: ShieldCheck },
                  { label: "Failed", count: result.summary.failed, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", icon: ShieldAlert },
                  { label: "Warnings", count: result.summary.warnings, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", icon: ShieldQuestion },
                ].map(({ label, count, color, bg, border, icon: Icon }, idx) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + idx * 0.1 }}
                  >
                    <Card className={`${border} ${bg} card-hover`}>
                      <CardContent className="p-5 text-center flex flex-col items-center justify-center h-full gap-1">
                        <Icon className={`w-5 h-5 ${color} mb-1`} />
                        <p className={`text-3xl font-bold tabular-nums ${color}`}>{count}</p>
                        <p className={`text-xs ${color}`}>{label}</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground/80">Individual Reports</h2>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 h-8 text-xs">
                      <Download className="w-3.5 h-3.5" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1.5 h-8 text-xs">
                      <FileText className="w-3.5 h-3.5" /> PDF
                    </Button>
                  </div>
                </div>

                {result.results.map((r, i) => (
                  <BatchImageReport
                    key={i}
                    result={r}
                    index={i}
                    isExpanded={expandedRows.has(i)}
                    onToggle={() => toggleRow(i)}
                  />
                ))}
              </motion.div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={handleReset} className="gap-2">
                  <RotateCcw className="w-4 h-4" />
                  New Batch
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function BatchImageReport({
  result: r,
  index,
  isExpanded,
  onToggle,
}: {
  result: BatchImageResult;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [expandedViolations, setExpandedViolations] = useState<Set<number>>(new Set());
  const [expandedPassed, setExpandedPassed] = useState<Set<string>>(new Set());
  const [expandedNA, setExpandedNA] = useState<Set<string>>(new Set());

  const vc = verdictConfig[r.verdict] || verdictConfig.WARNING;
  const VerdictIcon = vc.icon;

  const allPassed = r.passed_details || [];
  const passedDetails = allPassed.filter(p => p.status !== "not_applicable");
  const naDetails = allPassed.filter(p => p.status === "not_applicable");
  const passedCount = passedDetails.length;
  const naCount = naDetails.length;
  const violationCount = r.violations.length;
  const applicableRules = violationCount + passedCount;
  const passRate = applicableRules > 0 ? Math.round((passedCount / applicableRules) * 100) : 0;

  const sortedViolations = [...r.violations].sort(
    (a, b) => (severityConfig[b.severity]?.weight || 0) - (severityConfig[a.severity]?.weight || 0)
  );

  const severityCounts = r.violations.reduce<Record<string, number>>((acc, v) => {
    acc[v.severity] = (acc[v.severity] || 0) + 1;
    return acc;
  }, {});

  const passedByCategory = passedDetails.reduce<Record<string, PassedDetail[]>>((acc, pd) => {
    const cat = pd.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pd);
    return acc;
  }, {});

  const naByCategory = naDetails.reduce<Record<string, PassedDetail[]>>((acc, pd) => {
    const cat = pd.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pd);
    return acc;
  }, {});

  const expandAll = () => setExpandedViolations(new Set(r.violations.map((_, i) => i)));
  const collapseAll = () => setExpandedViolations(new Set());

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 + index * 0.08 }}
    >
      <Card className={`overflow-hidden card-hover ${vc.border}`}>
        <div
          className="flex items-stretch cursor-pointer hover:bg-accent/20 transition-colors"
          onClick={onToggle}
        >
          {r.image_url && (
            <div className="w-[140px] min-h-[100px] shrink-0 relative bg-muted/30 border-r border-border/30">
              <img
                src={r.image_url}
                alt={r.image_name}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="flex-1 p-4 flex items-center">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1.5">
                <VerdictIcon className={`w-5 h-5 ${vc.color} shrink-0`} />
                <h3 className="text-sm font-semibold truncate">{r.image_name}</h3>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className={`font-semibold ${vc.color}`}>
                  {vc.label}
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-red-400" />
                  {violationCount} violation{violationCount !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-green-400" />
                  {passedCount} passed
                </span>
                {naCount > 0 && (
                  <span className="flex items-center gap-1">
                    <CircleSlash className="w-3 h-3 text-muted-foreground" />
                    {naCount} N/A
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums text-foreground">{r.confidence}%</p>
                <p className="text-[10px] text-muted-foreground">confidence</p>
              </div>
              {r.session_id && (
                <Link
                  href={`/report/${r.session_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
                  title="Open full report"
                >
                  <ExternalLink className="w-4 h-4 text-primary" />
                </Link>
              )}
              <motion.div
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </motion.div>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border/30 p-5 space-y-5">
                <Card className={`${vc.border} overflow-hidden`}>
                  <CardContent className="p-0">
                    <div className={`${vc.bg} p-5`}>
                      <div className="flex items-start gap-4">
                        <VerdictIcon className={`w-8 h-8 ${vc.color} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className={`text-xl font-bold ${vc.color}`}>{vc.label}</h3>
                            <span className={`text-sm font-semibold ${vc.color}`}>{r.confidence}%</span>
                          </div>
                          {r.summary && (
                            <p className="text-sm text-foreground/80 leading-relaxed mb-3">{r.summary}</p>
                          )}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {r.session_id && (
                              <MetaChip icon={Hash} label="Report ID" value={`RPT-${r.session_id.slice(0, 8).toUpperCase()}`} />
                            )}
                            {r.content_type_detected && (
                              <MetaChip icon={Layers} label="Content Type" value={r.content_type_detected.replace(/_/g, " ")} />
                            )}
                            {r.image_width && r.image_height && (
                              <MetaChip icon={ImageIcon} label="Dimensions" value={`${r.image_width}×${r.image_height}`} />
                            )}
                            {r.background_type_detected && (
                              <MetaChip icon={Eye} label="Background" value={r.background_type_detected.replace(/_/g, " ")} />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <StatCard label="Passed" value={passedCount} color="text-green-600 dark:text-green-400" />
                  <StatCard label="Failed" value={violationCount} color="text-red-600 dark:text-red-400" />
                  <StatCard label="Not Applicable" value={naCount} color="text-muted-foreground" />
                  <StatCard label="Pass Rate" value={`${passRate}%`} color={passRate >= 80 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"} />
                  <StatCard label="Verdict" value={r.verdict} color={vc.color} />
                </div>

                {Object.keys(severityCounts).length > 0 && (
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
                )}

                <Tabs defaultValue="violations" className="w-full">
                  <TabsList className="w-full justify-start bg-muted/30">
                    <TabsTrigger value="violations" className="gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      Violations ({violationCount})
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
                  </TabsList>

                  <TabsContent value="violations" className="mt-4">
                    <div className="flex items-start gap-2.5 rounded-lg px-4 py-3 mb-4 bg-red-500/5 border border-red-500/15">
                      <Info className="w-4 h-4 text-red-500/70 mt-0.5 shrink-0" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        These are brand rules that the image does not comply with. Each violation includes what was found, why it fails, and a suggested fix.
                      </p>
                    </div>
                    {violationCount === 0 ? (
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
                          <p className="text-xs text-muted-foreground">Sorted by severity (critical first)</p>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={expandAll} className="text-xs h-7">Expand All</Button>
                            <Button variant="ghost" size="sm" onClick={collapseAll} className="text-xs h-7">Collapse All</Button>
                          </div>
                        </div>
                        {sortedViolations.map((v, i) => {
                          const origIdx = r.violations.indexOf(v);
                          return (
                            <ViolationCard
                              key={origIdx}
                              violation={v}
                              index={i}
                              expanded={expandedViolations.has(origIdx)}
                              onToggle={() => {
                                setExpandedViolations(prev => {
                                  const n = new Set(prev);
                                  n.has(origIdx) ? n.delete(origIdx) : n.add(origIdx);
                                  return n;
                                });
                              }}
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
                          <Card key={category} className="border-green-500/20 overflow-hidden">
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
                                {items.map((pd, j) => {
                                  const key = `${index}-${pd.rule_id}-${j}`;
                                  const isOpen = expandedPassed.has(key);
                                  return (
                                    <motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: j * 0.02 }}>
                                      <div className="rounded-lg border border-green-500/15 overflow-hidden bg-green-500/[0.03]">
                                        <div
                                          role="button"
                                          tabIndex={0}
                                          onClick={() => setExpandedPassed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedPassed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); }}}
                                          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-green-500/[0.06] transition-colors"
                                        >
                                          <div className="w-5 h-5 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                                          </div>
                                          <span className="text-sm font-medium text-foreground/90 flex-1">{getFriendlyName(pd.rule_id)}</span>
                                          <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.2 }}>
                                            <ChevronRight className="w-3.5 h-3.5 text-green-500/50" />
                                          </motion.div>
                                        </div>
                                        <AnimatePresence>
                                          {isOpen && (
                                            <motion.div
                                              initial={{ height: 0, opacity: 0 }}
                                              animate={{ height: "auto", opacity: 1 }}
                                              exit={{ height: 0, opacity: 0 }}
                                              transition={{ duration: 0.2 }}
                                              className="overflow-hidden"
                                            >
                                              <div className="px-3 pb-3 pt-1 ml-8 border-t border-green-500/10">
                                                <div className="flex items-start gap-2 mt-2">
                                                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                                                  <div>
                                                    <p className="text-[11px] font-medium text-green-600 dark:text-green-400 mb-1">Why it passed</p>
                                                    <p className="text-sm text-foreground/75 leading-relaxed">{pd.detail}</p>
                                                  </div>
                                                </div>
                                              </div>
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </div>
                                    </motion.div>
                                  );
                                })}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {naCount > 0 && (
                    <TabsContent value="na" className="mt-4">
                      <div className="flex items-start gap-2.5 rounded-lg px-4 py-3 mb-4 bg-violet-500/5 border border-violet-500/15">
                        <Info className="w-4 h-4 text-violet-400/70 mt-0.5 shrink-0" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          These rules don&apos;t apply to this particular image type. For example, dark background rules are skipped for light images, and educational content rules are skipped for flavour-led designs. Excluded from the pass rate.
                        </p>
                      </div>
                      <div className="space-y-4">
                        {Object.entries(naByCategory).map(([category, items]) => (
                          <Card key={category} className="border-violet-500/15 overflow-hidden">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm flex items-center gap-2 text-violet-400">
                                <Layers className="w-4 h-4" />
                                {category}
                                <Badge variant="outline" className="text-[10px] border-violet-500/25 text-violet-400 ml-auto">
                                  {items.length} skipped
                                </Badge>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0">
                              <div className="space-y-1.5">
                                {items.map((pd, j) => {
                                  const key = `na-${index}-${pd.rule_id}-${j}`;
                                  const isOpen = expandedNA.has(key);
                                  return (
                                    <motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: j * 0.02 }}>
                                      <div className="rounded-lg border border-violet-500/10 overflow-hidden bg-violet-500/[0.02]">
                                        <div
                                          role="button"
                                          tabIndex={0}
                                          onClick={() => setExpandedNA(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedNA(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); }}}
                                          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-violet-500/[0.05] transition-colors"
                                        >
                                          <div className="w-5 h-5 flex items-center justify-center shrink-0">
                                            <CircleSlash className="w-4 h-4 text-violet-400/60" />
                                          </div>
                                          <span className="text-sm font-medium text-foreground/70 flex-1">{getFriendlyName(pd.rule_id)}</span>
                                          <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.2 }}>
                                            <ChevronRight className="w-3.5 h-3.5 text-violet-400/40" />
                                          </motion.div>
                                        </div>
                                        <AnimatePresence>
                                          {isOpen && (
                                            <motion.div
                                              initial={{ height: 0, opacity: 0 }}
                                              animate={{ height: "auto", opacity: 1 }}
                                              exit={{ height: 0, opacity: 0 }}
                                              transition={{ duration: 0.2 }}
                                              className="overflow-hidden"
                                            >
                                              <div className="px-3 pb-3 pt-1 ml-8 border-t border-violet-500/10">
                                                <div className="flex items-start gap-2 mt-2">
                                                  <Info className="w-3.5 h-3.5 text-violet-400/60 mt-0.5 shrink-0" />
                                                  <div>
                                                    <p className="text-[11px] font-medium text-violet-400 mb-1">Why it was skipped</p>
                                                    <p className="text-sm text-foreground/60 leading-relaxed">{pd.detail}</p>
                                                  </div>
                                                </div>
                                              </div>
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </div>
                                    </motion.div>
                                  );
                                })}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </TabsContent>
                  )}
                </Tabs>

                {r.session_id && (
                  <div className="flex justify-end pt-2">
                    <Link href={`/report/${r.session_id}`}>
                      <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                        <FileText className="w-3.5 h-3.5" /> View Full Report
                      </Button>
                    </Link>
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
  const friendly = getFriendlyName(v.rule_id);

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
          className="p-4 cursor-pointer hover:bg-accent/5 transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className={`w-1 self-stretch rounded-full shrink-0 ${sev.color === "text-red-600 dark:text-red-400" ? "bg-red-500" : sev.color === "text-orange-600 dark:text-orange-400" ? "bg-orange-500" : "bg-yellow-500"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm font-semibold text-foreground">{friendly}</span>
                <Badge variant="outline" className={`${sev.bg} ${sev.color} ${sev.border} text-[10px] px-2 py-0 shrink-0`}>
                  {sev.label}
                </Badge>
              </div>
              <p className="text-sm text-foreground/70 leading-relaxed">{v.issue}</p>
            </div>
            <motion.div
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: 0.2 }}
              className="mt-1"
            >
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
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
              <div className="p-4 space-y-4 bg-muted/5">
                {v.rule_text && (
                  <div className="flex items-start gap-3">
                    <BookOpen className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground mb-1">Brand Guideline</p>
                      <p className="text-sm text-foreground/80 leading-relaxed">{v.rule_text}</p>
                    </div>
                  </div>
                )}
                {v.evidence && (
                  <div className="flex items-start gap-3">
                    <Eye className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground mb-1">What Was Found</p>
                      <p className="text-sm text-foreground/80 leading-relaxed">{v.evidence}</p>
                    </div>
                  </div>
                )}
                {v.fix_suggestion && (
                  <div className="flex items-start gap-3 rounded-lg bg-green-500/5 border border-green-500/15 p-3">
                    <Lightbulb className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[11px] font-medium text-green-600 dark:text-green-400 mb-1">How to Fix</p>
                      <p className="text-sm text-green-700 dark:text-green-300/90 leading-relaxed">{v.fix_suggestion}</p>
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
