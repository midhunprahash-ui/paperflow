"use client";

import { useEffect } from "react";
import type { ReactGrabAPI } from "react-grab";

/** Make the development picker discoverable, including after a saved collapse. */
export function ReactGrabDev() {
  useEffect(() => {
    const showToolbar = () => {
      const api: ReactGrabAPI | undefined = window.__REACT_GRAB__;
      api?.setEnabled(true);
      api?.setToolbarState({ collapsed: false, enabled: true, edge: "bottom", ratio: .5 });
    };
    // beforeInteractive may initialize before hydration, or finish afterwards.
    window.addEventListener("react-grab:init", showToolbar);
    showToolbar();
    return () => window.removeEventListener("react-grab:init", showToolbar);
  }, []);

  return null;
}
