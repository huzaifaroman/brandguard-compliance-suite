"use client";

import { motion } from "framer-motion";
import { getFriendlyName } from "@/lib/rule-names";
import type { Violation } from "@/lib/types";

interface BoundingBoxOverlayProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  violations: Violation[];
  maxHeight?: string;
  imageName?: string;
}

const NEON_COLORS: Record<string, string> = {
  critical: "#ff1744",
  high: "#ffea00",
  medium: "#76ff03",
};

const FILTER_IDS: Record<string, string> = {
  critical: "bbox-neon-red",
  high: "bbox-neon-yellow",
  medium: "bbox-neon-green",
};

export default function BoundingBoxOverlay({
  imageUrl,
  imageWidth,
  imageHeight,
  violations,
  maxHeight = "400px",
  imageName,
}: BoundingBoxOverlayProps) {
  const withBbox = violations.filter((v) => v.bbox);

  return (
    <div className="relative overflow-hidden rounded-lg bg-black/20">
      <img
        src={imageUrl}
        alt={imageName || "Analysis"}
        className="w-full object-contain mx-auto"
        style={{ maxHeight }}
      />
      {withBbox.length > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="bbox-neon-red" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="bbox-neon-yellow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="bbox-neon-green" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {withBbox.map((v, i) => {
            const bbox = v.bbox!;
            const neonColor = NEON_COLORS[v.severity] || "#76ff03";
            const filterId = FILTER_IDS[v.severity] || "bbox-neon-green";
            const label = getFriendlyName(v.rule_id);
            const labelW = Math.min(label.length * 8 + 16, bbox.w);
            return (
              <g key={i}>
                <motion.rect
                  x={bbox.x}
                  y={bbox.y}
                  width={bbox.w}
                  height={bbox.h}
                  fill="none"
                  stroke={neonColor}
                  strokeWidth={3}
                  filter={`url(#${filterId})`}
                  rx={3}
                  initial={{ opacity: 0, pathLength: 0 }}
                  animate={{ opacity: 1, pathLength: 1 }}
                  transition={{ delay: i * 0.12, duration: 0.5 }}
                />
                <motion.rect
                  x={bbox.x}
                  y={bbox.y}
                  width={bbox.w}
                  height={bbox.h}
                  fill={neonColor}
                  fillOpacity={0.08}
                  stroke="none"
                  rx={3}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.12 + 0.3, duration: 0.3 }}
                />
                <rect
                  x={bbox.x}
                  y={bbox.y - 20}
                  width={labelW}
                  height={20}
                  rx={3}
                  fill={neonColor}
                  fillOpacity={0.9}
                />
                <text
                  x={bbox.x + 6}
                  y={bbox.y - 5}
                  fill="#000"
                  fontSize="11"
                  fontWeight="700"
                  fontFamily="system-ui, sans-serif"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
