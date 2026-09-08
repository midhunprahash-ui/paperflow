"use client";

import { useEffect, useRef } from "react";
import type { ProcessingStage } from "@/lib/types/document";
import "./parsing-animation.css";

const circumference = 2 * Math.PI * 124;

export function ParsingAnimation({ stage, progress, ready, failed }: { stage: ProcessingStage; progress: number; ready: boolean; failed: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const percentage = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const previous = useRef(percentage);
  const phase = failed ? "paused" : ready ? "ready" : stage === "queued" ? "queued"
    : ["assembling", "assets", "quality_check"].includes(stage) ? "compose" : "scan";
  const label = phase === "ready" ? "COMPLETE" : phase === "paused" ? "PAUSED" : phase === "queued" ? "WAITING TO START"
    : stage === "validating" ? "INSPECTING PDF" : phase === "scan" ? "EXTRACTING CONTENT" : stage === "quality_check" ? "VERIFYING OUTPUT" : "ASSEMBLING READER";

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const offset = circumference * (1 - percentage / 100);
    const from = circumference * (1 - previous.current / 100);
    previous.current = percentage;
    // Restore the authoritative value before loading the optional animation.
    // It also remains correct with reduced motion or a failed chunk request.
    ring.current?.setAttribute("stroke-dashoffset", String(offset));
    void import("gsap").then(({ gsap }) => {
      if (disposed || !root.current) return;
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        const scene = gsap.timeline({ defaults: { ease: "power2.out" } });
        scene.fromTo(".parse-ring-value", { attr: { "stroke-dashoffset": from } }, {
          attr: { "stroke-dashoffset": offset }, duration: .9,
        }, 0);
        if (phase === "ready") {
          scene.fromTo(".parse-success", { scale: .85, opacity: 0 }, { scale: 1, opacity: 1, duration: .5 }, .1)
            .fromTo(".parse-check", { strokeDashoffset: 40 }, { strokeDashoffset: 0, duration: .5 }, .3);
        } else if (phase !== "paused") {
          // This fine inner arc indicates activity. The outer progress ring
          // never rotates or advances beyond the percentage from the job.
          const activity = gsap.timeline({ repeat: -1 });
          activity.to(".parse-activity", { rotation: 360, transformOrigin: "50% 50%", duration: phase === "queued" ? 12 : 8, ease: "none" });
          scene.add(activity, 0);
          if (phase !== "queued") {
            const content = gsap.timeline({ repeat: -1, repeatDelay: .8 });
            if (phase === "scan") {
              content.fromTo(".parse-scanline", { y: 0, opacity: 0 }, { opacity: .8, duration: .2 }, 0)
                .to(".parse-scanline", { y: 62, duration: 2.6, ease: "none" }, .2)
                .to(".parse-scanline", { opacity: 0, duration: .25 }, 2.8)
                .fromTo(".parse-region", { opacity: .12 }, { opacity: 1, duration: .5, stagger: .4 }, .4)
                .to(".parse-region", { opacity: .25, duration: .8 }, 3.3);
            } else {
              content.fromTo(".parse-region-title", { y: -5, opacity: .2 }, { y: 0, opacity: 1, duration: .8 }, 0)
                .fromTo(".parse-region-text", { x: -8, opacity: .2 }, { x: 0, opacity: 1, duration: .8 }, .2)
                .fromTo(".parse-region-figure", { x: 8, opacity: .2 }, { x: 0, opacity: 1, duration: .8 }, .4)
                .fromTo(".parse-region-equation", { y: 6, opacity: .2 }, { y: 0, opacity: 1, duration: .8 }, .6)
                .to(".parse-region", { opacity: .5, duration: .7 }, 3);
            }
            scene.add(content, .1);
          }
        }
        const visibility = () => { scene.paused(document.hidden); };
        visibility();
        document.addEventListener("visibilitychange", visibility);
        return () => document.removeEventListener("visibilitychange", visibility);
      }, root);
      cleanup = () => media.revert();
    }).catch(() => { /* Keep the static, accurate progress ring available. */ });
    return () => { disposed = true; cleanup?.(); };
  }, [phase, percentage]);

  return <div ref={root} className="parsing-meter" data-phase={phase} role="progressbar"
    aria-label="Document processing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${percentage}% — ${label.toLowerCase()}`}>
    <svg className="parse-rings" viewBox="0 0 300 300" fill="none" aria-hidden="true">
      <circle className="parse-ring-ticks" cx="150" cy="150" r="138" />
      <circle className="parse-ring-track" cx="150" cy="150" r="124" />
      <circle ref={ring} className="parse-ring-value" cx="150" cy="150" r="124" transform="rotate(-90 150 150)"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percentage / 100)} opacity={percentage === 0 ? 0 : 1} />
      <g className="parse-activity"><circle cx="150" cy="150" r="113" strokeDasharray="32 679" transform="rotate(-90 150 150)" /></g>
      <circle className="parse-ring-inner" cx="150" cy="150" r="104" />
    </svg>
    <div className="parse-meter-center" aria-hidden="true">
      <div className="parse-diagram">
        <svg className="parse-document" viewBox="0 0 90 100" fill="none">
          <rect className="parse-page-outline" x="17" y="7" width="56" height="81" rx="4" />
          <g className="parse-region parse-region-title"><rect x="24" y="16" width="42" height="13" rx="2" /><path d="M29 21h22m-22 4h30" /></g>
          <g className="parse-region parse-region-text"><rect x="24" y="35" width="21" height="27" rx="2" /><path d="M28 41h13m-13 5h13m-13 5h13m-13 5h8" /></g>
          <g className="parse-region parse-region-figure"><rect x="50" y="35" width="16" height="27" rx="2" /><path d="M54 57V48m4 9V42m4 15V46" /></g>
          <g className="parse-region parse-region-equation"><rect x="24" y="68" width="42" height="12" rx="2" /><path d="m34 71-3 3 3 3m5-6 3 3-3 3m6-4h10m-10 3h10" /></g>
          <path className="parse-scanline" d="M12 17h66" />
        </svg>
        <svg className="parse-success" viewBox="0 0 60 60" fill="none"><circle cx="30" cy="30" r="25" /><path className="parse-check" d="m17 30 9 9 18-18" /></svg>
        {failed && <div className="parse-pause"><span /><span /></div>}
      </div>
      <div className="parse-percentage"><span>{percentage}</span><small>%</small></div>
      <div className="parse-phase-label">{label}</div>
    </div>
  </div>;
}
