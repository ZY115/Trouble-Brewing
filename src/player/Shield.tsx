import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const ShieldContext = createContext(false);

const preferenceKey = () => {
  const seat = typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("debugSeat");
  return `clocktower.pref.shielded${seat ? `:${seat}` : ""}`;
};

export function useShieldPreference() {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey()) === "1";
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(preferenceKey(), next ? "1" : "0");
    } catch {
      return;
    }
  };
  return [value, set] as const;
}

export function useAutoHide(shown: boolean, hide: () => void) {
  useEffect(() => {
    if (!shown) return;
    const onBlur = () => hide();
    const onVisibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [shown]);
}

export default function Shield({ label, children }: { label: string; children: ReactNode }) {
  const shielded = useContext(ShieldContext);
  const [shown, setShown] = useState(false);
  useAutoHide(shown, () => setShown(false));
  useEffect(() => setShown(false), [shielded]);
  if (!shielded) return <>{children}</>;
  if (!shown)
    return (
      <button type="button" className="shield-cover" onClick={() => setShown(true)}>
        {label}已隐藏 · 点一下显示
      </button>
    );
  return (
    <>
      {children}
      <button type="button" className="link-button shield-close" onClick={() => setShown(false)}>
        收起
      </button>
    </>
  );
}
