import { useState } from "react";
import type { NightAction, RoomView } from "../../shared/types";
import { completedAction } from "../../shared/assistance";
import type { Send } from "../useRoom";
import { nightMessages } from "./visibility";
import BluffBoard from "./BluffBoard";

export function tonightActions(room: RoomView) {
  const tonight = room.actions.filter((a) => a.night === room.day);
  return {
    open: tonight.find((a) => !completedAction(a) && a.targetCount > 0 && a.canChangeTargets),
    pending: tonight.find((a) => !completedAction(a)),
    delivered: tonight.filter((a) => a.status === "DELIVERED").at(-1),
    closed: tonight.find((a) => completedAction(a) && a.status !== "DELIVERED"),
  };
}

const numbers = (room: RoomView, ids: string[]) =>
  ids.map((id) => room.seats.find((s) => s.id === id)?.number).join(" · ");

export default function NightCard({
  room,
  send,
  picked,
  selecting,
  onToggleMode,
  onSubmitted,
}: {
  room: RoomView;
  send: Send;
  picked: string[];
  selecting: boolean;
  onToggleMode: () => void;
  onSubmitted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { open, pending, delivered, closed } = tonightActions(room);
  const messages = nightMessages(room).filter((m) => m.atNight && m.night === room.day);
  const action: NightAction | undefined = open ?? pending ?? delivered;

  let body;
  if (open) {
    const submitted = open.status === "SUBMITTED" ? open.targets : [];
    const changed = picked.join() !== submitted.join();
    body = (
      <>
        <span className="pl-small">{open.prompt}</span>
        <span className="pl-picked" aria-live="polite">
          {picked.length ? numbers(room, picked) : "—"}
        </span>
        <span className="pl-small">
          {selecting
            ? `在圆桌上点 ${open.targetCount} 个号码，再点一次可取消`
            : "现在点圆桌是记笔记"}
        </span>
        <button
          className="pl-confirm"
          disabled={busy || picked.length !== open.targetCount || !changed}
          onClick={async () => {
            setBusy(true);
            if (
              await send({
                type: "submit_action",
                actionId: open.id,
                targets: picked,
                expectedVersion: open.selectionVersion ?? 0,
              })
            )
              onSubmitted();
            setBusy(false);
          }}
        >
          {submitted.length ? (changed ? "修改并发送" : "已发送 · 等待说书人回复") : "确认发送"}
        </button>
        <button className="link-button" onClick={onToggleMode}>
          {selecting ? "先记笔记" : "回到选择目标"}
        </button>
      </>
    );
  } else if (pending) {
    body = (
      <>
        <span className="pl-small">{pending.targets.length ? "已发送，等待说书人回复" : "说书人正在准备你的信息"}</span>
        <span className="pl-picked">{pending.targets.length ? numbers(room, pending.targets) : "…"}</span>
      </>
    );
  } else if (delivered) {
    body = (
      <>
        <span className="pl-small">
          说书人回复{delivered.targets.length ? ` · 你选择了 ${numbers(room, delivered.targets)}` : ""}
        </span>
        <span className="night-result">{delivered.response}</span>
        {(delivered.responseVersion ?? 1) > 1 && (
          <span className="pl-small">
            说书人更正了这条信息{delivered.responseHistory?.at(-1)?.reason ? `：${delivered.responseHistory.at(-1)!.reason}` : ""}
          </span>
        )}
      </>
    );
  } else if (closed)
    body = (
      <>
        <span className="pl-small">今晚的行动已结束</span>
        <span className="pl-picked">—</span>
        <span className="pl-small">可以点圆桌上的座位整理笔记</span>
      </>
    );
  else
    body = (
      <>
        <span className="pl-small">今晚没有需要你提交的行动</span>
        <span className="pl-picked">—</span>
        <span className="pl-small">可以点圆桌上的座位整理笔记</span>
      </>
    );

  return (
    <section className="pl-card night-card" aria-label="今晚">
      {body}
      {action && delivered && action !== delivered && (
        <span className="pl-small">
          今晚已收到：<b>{delivered.response}</b>
        </span>
      )}
      {messages.map((m) => (
        <div key={m.id} className="night-message">
          <span className="pl-small">说书人私信</span>
          <span>{m.text}</span>
        </div>
      ))}
      {room.phase === "FIRST_NIGHT" && <BluffBoard room={room} send={send} />}
    </section>
  );
}
