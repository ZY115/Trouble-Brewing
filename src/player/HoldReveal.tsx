import { useEffect, useState, type ReactNode } from "react";

export default function HoldReveal({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const hide = () => setShown(false);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  const show = () => setShown(true);
  const hide = () => setShown(false);
  return (
    <>
      {shown && (
        <div className="hold-panel" role="status">
          {children}
        </div>
      )}
      <button
        type="button"
        className="pl-hold"
        aria-pressed={shown}
        aria-label={`按住查看${label}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          show();
        }}
        onPointerUp={hide}
        onPointerCancel={hide}
        onLostPointerCapture={hide}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            show();
          }
        }}
        onKeyUp={hide}
        onBlur={hide}
      >
        {shown ? "松开隐藏" : label}
        <small aria-hidden="true">按住</small>
      </button>
    </>
  );
}
