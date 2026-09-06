"use client";
import { useEffect, useRef } from "react";

export function ReaderProgress() {
  const progressRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Native scroll timelines avoid JavaScript work on every scroll in browsers
    // that support them. The fallback coalesces events into one animation frame.
    if (typeof CSS !== "undefined" && CSS.supports?.("animation-timeline", "scroll()")) return;
    let frame = 0;
    function update() {
      frame = 0;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const progress = height <= 0 ? 1 : Math.min(1, Math.max(0, window.scrollY / height));
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${progress})`;
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    observer?.observe(document.body);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, []);
  return <span ref={progressRef} className="reader-progress" aria-hidden="true" />;
}
