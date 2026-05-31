import { useEffect, useState } from "react";

function computeActive(): boolean {
  if (typeof document === "undefined") return true;
  return document.hasFocus() && document.visibilityState === "visible";
}

export function useWindowFocus(): boolean {
  const [active, setActive] = useState<boolean>(computeActive);

  useEffect(() => {
    const update = () => setActive(computeActive());

    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return active;
}
