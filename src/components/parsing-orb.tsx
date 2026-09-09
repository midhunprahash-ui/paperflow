"use client";

import { useEffect, useState } from "react";
import { Shdr21 } from "./orbkit/shdr-21";

const stateColors = {
  idle: { light: "#e9ddc6", shadow: "#315d65" },
  thinking: { light: "#eee4d7", shadow: "#385c76" },
  speaking: { light: "#f3e4c9", shadow: "#376a65" },
};

export default function ParsingOrb({ phase, progress }: { phase: "queued" | "scan" | "compose"; progress: number }) {
  const completion = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress / 100 : 0));
  // Real job progress sets targets; OrbKit glides its uniforms and integrated
  // clock toward them without resetting the canvas or running React per frame.
  // Queued jobs remain quiet even if a retry carries an older progress value.
  const activity = phase === "queued" ? 0 : completion;
  const params = {
    speed: .55 + activity * 2.1,
    churn: .18 + activity * .32,
    ambient: .12 + activity * .24,
    power: 1.7 + activity * 1.1,
    shadowLift: .5 + activity * .35,
  };
  const volumes = { input: .08 + activity * .42, output: .12 + activity * .58 };
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
    params={params} volumes={volumes} stateColors={stateColors} paused={paused} pauseOffscreen />;
}
