import type { ReactNode } from "react";

export interface CheckItem {
  ok: boolean;
  text: string;
}

/** The single focus of the storyteller's screen: what happened, then one decision. */
export function TaskCard({
  eyebrow,
  title,
  children,
  waiting = false,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  waiting?: boolean;
}) {
  return (
    <section className={`task-card ${waiting ? "waiting" : ""}`} aria-label="当前任务">
      <div className="task-eyebrow">{eyebrow}</div>
      <h2 className="task-title">{title}</h2>
      {children}
    </section>
  );
}

export function Checks({ items }: { items: CheckItem[] }) {
  if (!items.length) return null;
  return (
    <ul className="task-checks" aria-label="自动核对">
      {items.map((i) => (
        <li key={i.text} className={i.ok ? "ok" : "warn"}>
          <i aria-hidden="true">{i.ok ? "✓" : "!"}</i>
          {i.text}
        </li>
      ))}
    </ul>
  );
}

/** One primary button, then quieter alternatives. */
export function TaskActions({ children }: { children: ReactNode }) {
  return <div className="task-actions">{children}</div>;
}

export function TaskNote({ children }: { children: ReactNode }) {
  return <p className="task-note">{children}</p>;
}
