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
  X,
} from "lucide-react";
import { analyzeImage, getChatMessages, streamChatMessage } from "@/lib/api";
import type { ComplianceResult, Violation, ChatMessage } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const severityConfig = {
  critical: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Critical" },
  high: { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", label: "High" },
  medium: { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", label: "Medium" },
};

const verdictConfig = {
  PASS: { icon: ShieldCheck, color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", glow: "shadow-[0_0_30px_rgba(34,197,94,0.15)]", label: "Compliant" },
  FAIL: { icon: ShieldAlert, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", glow: "shadow-[0_0_30px_rgba(239,68,68,0.15)]", label: "Non-Compliant" },
  WARNING: { icon: ShieldQuestion, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", glow: "shadow-[0_0_30px_rgba(245,158,11,0.15)]", label: "Needs Review" },
};

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

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
    setShowChat(false);
    setChatMessages([]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    maxFiles: 1,
    maxSize: 20 * 1024 * 1024,
  });

  useEffect(() => {
    if (!loading) return;
    setLoadingProgress(0);
    const steps = [
      { target: 15, delay: 300 },
      { target: 35, delay: 1200 },
      { target: 55, delay: 2500 },
      { target: 75, delay: 5000 },
      { target: 88, delay: 8000 },
    ];
    const timers = steps.map(({ target, delay }) =>
      setTimeout(() => setLoadingProgress(target), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeImage(file, prompt || undefined);
      setLoadingProgress(100);
      await new Promise((r) => setTimeout(r, 300));
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
      setLoadingProgress(0);
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
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setPrompt("");
    setShowChat(false);
    setChatMessages([]);
  };

  const checksPassedCount = Array.isArray(result?.checks_passed)
    ? result.checks_passed.length
    : typeof result?.checks_passed === "number"
    ? result.checks_passed
    : 0;

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-primary/10">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Analyze Image</h1>
              <p className="text-sm text-muted-foreground">
                Upload a marketing asset for AI-powered compliance review against 62 brand rules
              </p>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className={`${result ? "xl:col-span-5" : "xl:col-span-6 xl:col-start-4"} space-y-4 transition-all duration-500`}>
            <Card className="overflow-hidden border-border/50">
              <CardContent className="p-0">
                <div
                  {...getRootProps()}
                  className={`relative cursor-pointer transition-all duration-300 ${
                    isDragActive ? "ring-2 ring-primary/50" : ""
                  }`}
                >
                  <input {...getInputProps()} />
                  {preview ? (
                    <div className="relative group">
                      <div className="relative overflow-hidden bg-black/20">
                        <img
                          src={preview}
                          alt="Preview"
                          className="w-full max-h-[400px] object-contain mx-auto"
                        />
                        {result && result.violations.length > 0 && (
                          <svg
                            className="absolute inset-0 w-full h-full pointer-events-none"
                            viewBox={`0 0 ${result.image_width || 1000} ${result.image_height || 1000}`}
                            preserveAspectRatio="xMidYMid meet"
                          >
                            {result.violations.map((v, i) =>
                              v.bbox ? (
                                <g key={i}>
                                  <rect
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
                                    className="transition-all duration-200"
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
                    <div className={`p-12 text-center transition-all duration-300 ${isDragActive ? "bg-primary/5" : ""}`}>
                      <motion.div
                        animate={isDragActive ? { scale: 1.1, y: -5 } : { scale: 1, y: 0 }}
                        className="inline-flex p-4 rounded-2xl bg-primary/5 mb-4"
                      >
                        <Upload className="w-8 h-8 text-primary/60" />
                      </motion.div>
                      <p className="text-sm font-medium mb-1">
                        {isDragActive ? "Release to upload" : "Drop image or click to browse"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PNG, JPG, WEBP up to 20MB
                      </p>
                    </div>
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
                className="flex-1 h-10 px-4 text-sm rounded-lg bg-card border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
              {result ? (
                <Button variant="outline" size="sm" onClick={handleReset} className="h-10 px-4">
                  New
                </Button>
              ) : null}
              <Button
                onClick={handleSubmit}
                disabled={!file || loading}
                className="h-10 px-6 gap-2"
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
                >
                  <Card className="border-primary/20">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                          </div>
                          <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">AI Analysis in Progress</p>
                          <p className="text-xs text-muted-foreground">
                            {loadingProgress < 30
                              ? "Uploading to Azure Blob Storage..."
                              : loadingProgress < 55
                              ? "Azure Vision 4.0 extracting visual signals..."
                              : loadingProgress < 80
                              ? "GPT-4.1 evaluating 62 brand rules..."
                              : "Finalizing compliance report..."}
                          </p>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">{loadingProgress}%</span>
                      </div>
                      <Progress value={loadingProgress} className="h-1" />
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className="border-red-500/30 bg-red-500/5">
                  <CardContent className="p-4">
                    <p className="text-sm text-red-400">{error}</p>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>

          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4 }}
                className="xl:col-span-7 space-y-4"
              >
                {(() => {
                  const vc = verdictConfig[result.verdict];
                  const VIcon = vc.icon;
                  return (
                    <Card className={`${vc.border} ${vc.glow} overflow-hidden`}>
                      <CardContent className="p-0">
                        <div className={`flex items-center gap-4 p-5 ${vc.bg}`}>
                          <div className={`p-3 rounded-xl ${vc.bg}`}>
                            <VIcon className={`w-7 h-7 ${vc.color}`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1">
                              <span className={`text-lg font-bold ${vc.color}`}>{vc.label}</span>
                              <Badge variant="outline" className={`${vc.color} ${vc.border} text-xs`}>
                                {result.confidence}% confidence
                              </Badge>
                              {result.cached && (
                                <Badge variant="outline" className="text-blue-400 border-blue-500/30 text-xs gap-1">
                                  <Zap className="w-3 h-3" /> Cached
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{result.summary}</p>
                          </div>
                        </div>
                        <Separator />
                        <div className="grid grid-cols-4 divide-x divide-border">
                          <Stat label="Verdict" value={result.verdict} className={vc.color} />
                          <Stat label="Checks Passed" value={String(checksPassedCount)} className="text-green-400" />
                          <Stat label="Violations" value={String(result.violations.length)} className={result.violations.length > 0 ? "text-red-400" : "text-green-400"} />
                          <Stat label="Content Type" value={result.content_type_detected?.replace(/_/g, " ") || "N/A"} className="text-muted-foreground" small />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {result.violations.length > 0 && (
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
                )}

                {result.session_id && (
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
                          className="text-xs h-7"
                        >
                          {showChat ? "Hide" : "Ask about results"}
                          <ChevronRight className={`w-3 h-3 ml-1 transition-transform ${showChat ? "rotate-90" : ""}`} />
                        </Button>
                      </div>
                    </CardHeader>
                    <AnimatePresence>
                      {showChat && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                        >
                          <CardContent className="pt-0 pb-4 px-4">
                            <ScrollArea className="h-[240px] mb-3 rounded-lg bg-muted/30 p-3">
                              {chatMessages.length === 0 && !chatStreaming && (
                                <div className="flex items-center justify-center h-full">
                                  <p className="text-xs text-muted-foreground text-center">
                                    Ask about specific violations, how to fix issues,<br />or what the brand rules require.
                                  </p>
                                </div>
                              )}
                              {chatMessages.map((msg, i) => (
                                <div
                                  key={i}
                                  className={`mb-3 ${msg.role === "user" ? "text-right" : ""}`}
                                >
                                  <div
                                    className={`inline-block max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                                      msg.role === "user"
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-foreground"
                                    }`}
                                  >
                                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                  </div>
                                </div>
                              ))}
                              <div ref={chatEndRef} />
                            </ScrollArea>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                                placeholder="Ask about this analysis..."
                                className="flex-1 h-9 px-3 text-sm rounded-lg bg-muted/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                                disabled={chatStreaming}
                              />
                              <Button
                                size="sm"
                                onClick={handleSendChat}
                                disabled={!chatInput.trim() || chatStreaming}
                                className="h-9 w-9 p-0"
                              >
                                {chatStreaming ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Send className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </CardContent>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, className, small }: { label: string; value: string; className?: string; small?: boolean }) {
  return (
    <div className="p-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className={`${small ? "text-xs" : "text-sm"} font-semibold capitalize ${className}`}>{value}</p>
    </div>
  );
}

function ViolationRow({
  violation,
  index,
  isHovered,
  onHover,
}: {
  violation: Violation;
  index: number;
  isHovered: boolean;
  onHover: (hovered: boolean) => void;
}) {
  const sev = severityConfig[violation.severity as keyof typeof severityConfig] || severityConfig.medium;
  return (
    <div
      className={`px-4 py-3 transition-colors cursor-default ${
        isHovered ? "bg-accent/50" : "hover:bg-accent/30"
      }`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <Badge variant="outline" className={`${sev.color} ${sev.border} text-[10px] px-1.5`}>
            {sev.label}
          </Badge>
          {violation.bbox && (
            <Tooltip>
              <TooltipTrigger>
                <Eye className="w-3 h-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Bounding box: ({violation.bbox.x}, {violation.bbox.y}) {violation.bbox.w}x{violation.bbox.h}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-xs font-mono font-bold text-primary">{violation.rule_id}</code>
            {violation.rule_text && (
              <span className="text-[10px] text-muted-foreground truncate">{violation.rule_text}</span>
            )}
          </div>
          <p className="text-sm text-foreground mb-1">{violation.issue}</p>
          {violation.evidence && (
            <p className="text-xs text-muted-foreground mb-1">
              <span className="font-medium">Evidence:</span> {violation.evidence}
            </p>
          )}
          {violation.fix_suggestion && (
            <p className="text-xs text-green-400/80">
              <span className="font-medium">Fix:</span> {violation.fix_suggestion}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
