"use client";

import { Component, useEffect, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { ProcessingStage } from "@/lib/types/document";
import "./parsing-animation.css";

const circumference = 2 * Math.PI * 124;
const ParsingOrb = dynamic(() => import("./parsing-orb"), { ssr: false });

// The optional decoration must never take the job status or retry controls down.
class OrbBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function ParsingAnimation({ stage, progress, ready, failed }: { stage: ProcessingStage; progress: number; ready: boolean; failed: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const percentage = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const phase = failed ? "paused" : ready ? "ready" : stage === "queued" ? "queued"
    : ["assembling", "assets", "quality_check"].includes(stage) ? "compose" : "scan";
  const label = phase === "ready" ? "COMPLETE" : phase === "paused" ? "PAUSED" : phase === "queued" ? "WAITING TO START"
    : stage === "validating" ? "INSPECTING PDF" : phase === "scan" ? "EXTRACTING CONTENT" : stage === "quality_check" ? "VERIFYING OUTPUT" : "ASSEMBLING READER";

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    if (phase !== "ready") return;
    void import("gsap").then(({ gsap }) => {
      if (disposed || !root.current) return;
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const scene = gsap.timeline({ defaults: { ease: "power2.out" } });
        if (phase === "ready") {
          scene.fromTo(".parse-success", { scale: .85, opacity: 0 }, { scale: 1, opacity: 1, duration: .5 }, .1)
            .fromTo(".parse-check", { strokeDashoffset: 40 }, { strokeDashoffset: 0, duration: .5 }, .3);
        }
        const visibility = () => { scene.paused(document.hidden); };
        visibility();
        document.addEventListener("visibilitychange", visibility);
        return () => document.removeEventListener("visibilitychange", visibility);
      }, root);
      cleanup = () => media.revert();
    }).catch(() => { /* Keep the static, accurate progress ring available. */ });
    return () => { disposed = true; cleanup?.(); };
  }, [phase]);

  return <div ref={root} className="parsing-meter" data-phase={phase} role="progressbar"
    aria-label="Document processing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${percentage}% — ${label.toLowerCase()}`}>
    <svg className="parse-rings" viewBox="0 0 300 300" fill="none" aria-hidden="true">
      <circle className="parse-ring-track" cx="150" cy="150" r="124" />
      <circle className="parse-ring-value" cx="150" cy="150" r="124" transform="rotate(-90 150 150)"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percentage / 100)} opacity={percentage === 0 ? 0 : 1} />

    </svg>
    <div className="parse-meter-center" aria-hidden="true">
      <div className="parse-diagram">
        {phase !== "ready" && phase !== "paused" && <div className="parse-orb-surface"><OrbBoundary><ParsingOrb phase={phase} progress={percentage} /></OrbBoundary></div>}
        <svg className="parse-success" viewBox="0 0 60 60" fill="none"><circle cx="30" cy="30" r="25" /><path className="parse-check" d="m17 30 9 9 18-18" /></svg>
        {failed && <div className="parse-pause"><span /><span /></div>}
      </div>
    </div>
  </div>;
}
