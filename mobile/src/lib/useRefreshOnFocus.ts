import { useEffect, useRef } from "react";

export function useRefreshOnFocus(refresh: () => void | Promise<void>, enabled = true) {
  const refreshRef = useRef(refresh);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const handleFocus = () => {
      if (!enabled || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRefreshAtRef.current < 1000) return;
      lastRefreshAtRef.current = now;
      void refreshRef.current();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [enabled]);
}
