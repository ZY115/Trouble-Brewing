import { useEffect, useMemo, useState } from "react";

export function useCountdown(msLeft: number | undefined) {
  const deadline = useMemo(() => (msLeft === undefined ? null : Date.now() + msLeft), [msLeft]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}
