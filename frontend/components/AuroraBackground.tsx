"use client";

import { memo } from "react";

function AuroraBackgroundInner() {
  return (
    <div className="aurora-bg" aria-hidden="true">
      <div className="aurora-container">
        <div className="aurora-orb aurora-orb-1" />
        <div className="aurora-orb aurora-orb-2" />
        <div className="aurora-orb aurora-orb-3" />
      </div>
      <div className="aurora-grid" />
      <div className="aurora-noise" />
    </div>
  );
}

export const AuroraBackground = memo(AuroraBackgroundInner);
