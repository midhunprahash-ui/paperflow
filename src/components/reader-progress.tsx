"use client";

import { useEffect, useRef } from "react";

export function ReaderProgress() {
  const progressRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    function update() {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const progress = height <= 0 ? 100 : Math.min(100, Math.round((window.scrollY / height) * 100));
      if (progressRef.current) progressRef.current.style.width = `${progress}%`;
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  return <span ref={progressRef} className="reader-progress" />;
}
