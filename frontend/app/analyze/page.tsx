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
} from "lucide-react";
import Link from "next/link";
import { RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";
import { analyzeImage, getChatMessages, streamChatMessage } from "@/lib/api";
import type { ComplianceResult, Violation, ChatMessage, PassedDetail } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const severityConfig = {
  critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Critical" },
  high: { color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", label: "High" },
  medium: { color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", label: "Medium" },
};

const verdictConfig = {
  PASS: { icon: ShieldCheck, color: "text-green-600 dark:text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", glow: "", label: "Compliant", fill: "#22c55e" },
  FAIL: { icon: ShieldAlert, color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", glow: "", label: "Non-Compliant", fill: "#ef4444" },
  WARNING: { icon: ShieldQuestion, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", glow: "", label: "Needs Review", fill: "#f59e0b" },
};

const pipelineSteps = [
  { icon: Cloud, label: "Uploading to Azure", sublabel: "Blob Storage" },
  { icon: ScanEye, label: "Vision Analysis", sublabel: "Azure Vision 4.0" },
  { icon: Brain, label: "AI Evaluation", sublabel: "GPT-4.1 · 62 rules" },
  { icon: FileCheck, label: "Building Report", sublabel: "Compliance report" },
];

export default function AnalyzePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredViolation, setHoveredViolation] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [animatedConfidence, setAnimatedConfidence] = useState(0);

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
    setShowChat(false);
    setChatMessages([]);
  }, [preview]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: 1,
    maxSize: 20 * 1024 * 1024,
  });

  useEffect(() => {
    if (!loading) return;
    setLoadingProgress(0);
    setActiveStep(0);
    const steps = [
      { target: 15, step: 0, delay: 300 },
      { target: 35, step: 1, delay: 1500 },
      { target: 60, step: 2, delay: 3000 },
      { target: 80, step: 2, delay: 6000 },
      { target: 90, step: 3, delay: 9000 },
    ];
    const timers = steps.map(({ target, step, delay }) =>
      setTimeout(() => { setLoadingProgress(target); setActiveStep(step); }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  useEffect(() => {
    if (!result) { setAnimatedConfidence(0); return; }
    const target = result.confidence;
    let current = 0;
    const duration = 1200;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      current = Math.round(eased * target);
      setAnimatedConfidence(current);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [result]);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeImage(file, prompt || undefined);
      setLoadingProgress(100);
      setActiveStep(3);
      await new Promise((r) => setTimeout(r, 500));
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
      setLoadingProgress(0);
      setActiveStep(0);
    }
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

  const handleReset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setPrompt("");
    setShowChat(false);
    setChatMessages([]);
  };

  const passedDetails = result?.passed_details || [];
  const checksPassedCount = passedDetails.length;

  const passedByCategory = passedDetails.reduce<Record<string, PassedDetail[]>>((acc, pd) => {
    if (!acc[pd.category]) acc[pd.category] = [];
    acc[pd.category].push(pd);
    return acc;
  }, {});

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl bg-primary/10 animate-glow-pulse">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight gradient-text">Analyze Image</h1>
              <p className="text-sm text-muted-foreground">
                Upload a marketing asset for AI-powered compliance review against 62 brand rules
              </p>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <motion.div
            layout
            className={`${result ? "xl:col-span-5" : "xl:col-span-6 xl:col-start-4"} space-y-4`}
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
                          className="w-full max-h-[400px] object-contain mx-auto"
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
                                    fill={hoveredViolation === i ? "rgba(239,68,68,0.15)" : "none"}
                                    stroke={
                                      v.severity === "critical"
                                        ? "#ef4444"
                                        : v.severity === "high"
                                        ? "#f97316"
                                        : "#eab308"
                                    }
                                    strokeWidth={hoveredViolation === i ? 4 : 2}
                                    strokeDasharray={hoveredViolation === i ? "none" : "6 3"}
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

            <div className="flex gap-3">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Optional: focus on specific rules..."
                className="flex-1 h-10 px-4 text-sm rounded-lg bg-card border border-border/50 text-foreground placeholder:text-muted-foreground input-premium focus:outline-none"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
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

            <AnimatePresence>
              {loading && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className="border-primary/20 overflow-hidden">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">AI Analysis Pipeline</p>
                        <span className="text-xs font-mono text-primary">{loadingProgress}%</span>
                      </div>
                      <Progress value={loadingProgress} className="h-1.5" />
                      <div className="grid grid-cols-4 gap-2">
                        {pipelineSteps.map((step, i) => {
                          const StepIcon = step.icon;
                          const isActive = activeStep === i;
                          const isDone = activeStep > i;
                          return (
                            <motion.div
                              key={i}
                              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg transition-all duration-500 ${
                                isActive ? "bg-primary/10" : isDone ? "bg-green-500/5" : "bg-muted/30"
                              }`}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: i * 0.1 }}
                            >
                              <div className={`relative p-1.5 rounded-lg transition-colors duration-500 ${
                                isActive ? "text-primary" : isDone ? "text-green-500" : "text-muted-foreground/50"
                              }`}>
                                {isDone ? (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 500, damping: 15 }}
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </motion.div>
                                ) : isActive ? (
                                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                                    <StepIcon className="w-4 h-4" />
                                  </motion.div>
                                ) : (
                                  <StepIcon className="w-4 h-4" />
                                )}
                              </div>
                              <span className={`text-[10px] font-medium text-center leading-tight transition-colors duration-500 ${
                                isActive ? "text-primary" : isDone ? "text-green-500/80" : "text-muted-foreground/50"
                              }`}>
                                {step.label}
                              </span>
                              <span className="text-[9px] text-muted-foreground/50 text-center leading-tight">
                                {step.sublabel}
                              </span>
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
          </motion.div>

          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="xl:col-span-7 space-y-4"
              >
                {(() => {
                  const vc = verdictConfig[result.verdict];
                  const VIcon = vc.icon;
                  const chartData = [{ value: animatedConfidence, fill: vc.fill }];
                  return (
                    <Card className={`${vc.border} ${vc.glow} overflow-hidden`}>
                      <CardContent className="p-0">
                        <div className={`flex items-center gap-4 p-5 ${vc.bg}`}>
                          <div className="relative flex-shrink-0">
                            <RadialBarChart
                              width={80}
                              height={80}
                              cx={40}
                              cy={40}
                              innerRadius={28}
                              outerRadius={38}
                              barSize={8}
                              data={chartData}
                              startAngle={90}
                              endAngle={-270}
                            >
                              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                              <RadialBar
                                dataKey="value"
                                cornerRadius={4}
                                background={{ fill: "rgba(255,255,255,0.08)" }}
                              />
                            </RadialBarChart>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className={`text-sm font-bold tabular-nums ${vc.color}`}>{animatedConfidence}%</span>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <motion.div
                                initial={{ scale: 0, rotate: -180 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: "spring", stiffness: 400, damping: 15 }}
                              >
                                <VIcon className={`w-6 h-6 ${vc.color}`} />
                              </motion.div>
                              <motion.span
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.15 }}
                                className={`text-lg font-bold ${vc.color}`}
                              >
                                {vc.label}
                              </motion.span>
                              {result.cached && (
                                <Badge variant="outline" className="text-blue-400 border-blue-500/30 text-xs gap-1">
                                  <Zap className="w-3 h-3" /> Cached
                                </Badge>
                              )}
                              {result.session_id && (
                                <Link href={`/report/${result.session_id}`}>
                                  <Button variant="outline" size="sm" className="ml-auto h-7 text-xs gap-1.5">
                                    <FileText className="w-3 h-3" /> Full Report
                                  </Button>
                                </Link>
                              )}
                            </div>
                            <motion.p
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: 0.25 }}
                              className="text-sm text-muted-foreground leading-relaxed"
                            >
                              {result.summary}
                            </motion.p>
                          </div>
                        </div>
                        <Separator />
                        <div className="grid grid-cols-4 divide-x divide-border">
                          {[
                            { label: "Verdict", value: result.verdict, className: vc.color },
                            { label: "Checks Passed", value: String(checksPassedCount), className: "text-green-400" },
                            { label: "Violations", value: String(result.violations.length), className: result.violations.length > 0 ? "text-red-400" : "text-green-400" },
                            { label: "Content Type", value: result.content_type_detected?.replace(/_/g, " ") || "N/A", className: "text-muted-foreground", small: true },
                          ].map((stat, i) => (
                            <motion.div
                              key={stat.label}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.3 + i * 0.08 }}
                              className="p-3 text-center"
                            >
                              <p className={`text-sm font-bold ${stat.className}`}>
                                {stat.small ? (
                                  <span className="text-xs capitalize">{stat.value}</span>
                                ) : (
                                  stat.value
                                )}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</p>
                            </motion.div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {result.violations.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Eye className="w-4 h-4 text-muted-foreground" />
                          Violations ({result.violations.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <ScrollArea className="max-h-[400px]">
                          <div className="space-y-px">
                            {result.violations.map((v, i) => (
                              <ViolationRow
                                key={i}
                                violation={v}
                                index={i}
                                isHovered={hoveredViolation === i}
                                onHover={(h) => setHoveredViolation(h ? i : null)}
                              />
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {checksPassedCount > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.45 }}
                  >
                    <Card className="border-green-500/20">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                          <span className="text-green-400">Passed Checks ({checksPassedCount})</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <ScrollArea className="max-h-[350px]">
                          <div className="space-y-3">
                            {Object.entries(passedByCategory).map(([category, items]) => (
                              <div key={category}>
                                <p className="text-xs font-semibold text-green-500/80 uppercase tracking-wider mb-1.5">{category}</p>
                                <div className="space-y-1">
                                  {items.map((pd, i) => (
                                    <motion.div
                                      key={`${pd.rule_id}-${i}`}
                                      initial={{ opacity: 0, x: -8 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{ delay: 0.5 + i * 0.03 }}
                                      className="flex items-start gap-2 rounded-md px-3 py-2 bg-green-500/5 border border-green-500/10"
                                    >
                                      <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px] border-green-500/30 text-green-500">
                                        {pd.rule_id}
                                      </Badge>
                                      <p className="text-xs text-muted-foreground leading-relaxed">{pd.detail}</p>
                                    </motion.div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {result.session_id && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                  >
                    <Card>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-muted-foreground" />
                            AI Assistant
                          </CardTitle>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowChat(!showChat)}
                            className="text-xs h-7 gap-1"
                          >
                            {showChat ? "Hide" : "Ask about results"}
                            <motion.div
                              animate={{ rotate: showChat ? 90 : 0 }}
                              transition={{ duration: 0.2 }}
                            >
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
                              <ScrollArea className="h-[260px] mb-3 rounded-lg bg-muted/20 p-3">
                                {chatMessages.length === 0 && !chatStreaming && (
                                  <div className="flex items-center justify-center h-full">
                                    <div className="text-center">
                                      <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                                      <p className="text-xs text-muted-foreground">
                                        Ask about specific violations, how to fix issues,<br />or what the brand rules require.
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
                                  placeholder="Ask about this analysis..."
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
    </div>
  );
}

function ViolationRow({
  violation: v,
  index: i,
  isHovered,
  onHover,
}: {
  violation: Violation;
  index: number;
  isHovered: boolean;
  onHover: (h: boolean) => void;
}) {
  const sev = severityConfig[v.severity] || severityConfig.medium;
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.08 }}
      className={`px-4 py-3 transition-colors duration-200 cursor-pointer ${
        isHovered ? "bg-accent/30" : "hover:bg-accent/20"
      }`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={() => setExpanded(!expanded)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
    >
      <div className="flex items-start gap-3">
        <Badge variant="outline" className={`${sev.bg} ${sev.color} ${sev.border} text-[10px] px-1.5 shrink-0 mt-0.5`}>
          {sev.label}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <code className="text-xs font-mono font-bold text-primary">{v.rule_id}</code>
            {v.bbox && (
              <Tooltip>
                <TooltipTrigger>
                  <div className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded font-mono">
                    {v.bbox.x},{v.bbox.y}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Bounding box: ({v.bbox.x}, {v.bbox.y}, {v.bbox.w}×{v.bbox.h})</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">{v.issue}</p>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-1.5">
                  {v.evidence && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/70">Evidence:</span> {v.evidence}
                    </p>
                  )}
                  {v.fix_suggestion && (
                    <p className="text-xs text-green-400/80">
                      <span className="font-medium text-green-400">Fix:</span> {v.fix_suggestion}
                    </p>
                  )}
                  {v.rule_text && (
                    <p className="text-xs text-muted-foreground/70 italic">{v.rule_text}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        </motion.div>
      </div>
    </motion.div>
  );
}
