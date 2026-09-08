"use client";

import { useEffect, useState } from "react";
import { Shdr21 } from "./orbkit/shdr-21";

const params = { speed: 1.2 };
const stateColors = {
  idle: { light: "#e9ddc6", shadow: "#315d65" },
  thinking: { light: "#eee4d7", shadow: "#385c76" },
  speaking: { light: "#f3e4c9", shadow: "#376a65" },
};

export default function ParsingOrb({ phase }: { phase: "queued" | "scan" | "compose" }) {
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setPaused(document.hidden || motion.matches);
      setReducedMotion(motion.matches);
    };
    update();
    document.addEventListener("visibilitychange", update);
    motion.addEventListener("change", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      motion.removeEventListener("change", update);
    };
  }, []);

  return <Shdr21 key={String(reducedMotion)} className="parse-orb-canvas" maxDpr={1} maxFps={30}
    state={phase === "queued" ? "idle" : phase === "scan" ? "thinking" : "speaking"}
    params={params} stateColors={stateColors} paused={paused} pauseOffscreen />;
}
