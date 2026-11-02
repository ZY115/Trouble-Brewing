import { useState } from "react";
import type { NightAction, RoomView } from "../../shared/types";
import { completedAction } from "../../shared/assistance";
import { toggleChoice } from "../../shared/action-choice";
import type { Send } from "../useRoom";
import { localKey, useLocalState } from "../localState";

/**
 * Every player sees this same screen at night: a prompt line, a number pad and
 * one button. Players with an ability submit targets; everyone else can jot
 * down suspicions that stay on their own phone. Numbers are the only large
 * text, so a glance at a neighbour's screen tells nothing.
 */
export default function PlayerNight({ room, send }: { room: RoomView; send: Send }) {
  const me = room.viewer.seatId!;
  // After the storyteller answers, the card must not change until dawn:
  // keep showing the submitted pick instead of falling back to "no action".
  const tonight = room.actions.filter((a) => a.night === room.day && a.targetCount > 0);
  const action: NightAction | undefined =
    tonight.find((a) => !completedAction(a)) ?? tonight.filter((a) => a.targets.length).at(-1);
  const locked = !!action && (completedAction(action) || !action.canChangeTargets);
  const max = action?.targetCount ?? 2;
  const [draft, setDraft, clearDraft] = useLocalState<{ id: string; targets: string[] }>(
    localKey(room, `night-pick:${room.day}`),
    { id: "", targets: [] },
  );
  const [notes, setNotes] = useLocalState<Record<string, string[]>>(
    localKey(room, "night-suspicions"),
    {},
  );
  const [busy, setBusy] = useState(false);
  const submitted = action?.targets ?? [];
  const saved = notes[String(room.day)] ?? [];
  const base = action ? submitted : saved;
  const picked = draft.id === (action?.id ?? "note") ? draft.targets : base;
  const changed = picked.join() !== base.join();
  // A locked pick keeps the same look; taps simply do nothing.
  const pick = (id: string) =>
    !locked &&
    setDraft({ id: action?.id ?? "note", targets: toggleChoice(picked, id, max) });
  const big = picked.map((id) => room.seats.find((s) => s.id === id)?.number).join(" · ");
  async function confirm() {
    if (action) {
      setBusy(true);
      if (
        await send({
          type: "submit_action",
          actionId: action.id,
          targets: picked,
          expectedVersion: action.selectionVersion ?? 0,
        })
      )
        clearDraft();
      setBusy(false);
    } else {
      setNotes({ ...notes, [String(room.day)]: picked });
      clearDraft();
    }
  }
  const ready = action ? picked.length === action.targetCount : picked.length > 0;
  const status = action
    ? locked
      ? "已提交 · 天亮时统一揭晓"
      : action.status === "SUBMITTED" && !changed
        ? "已提交 · 说书人回复前可以改 · 天亮时统一揭晓"
        : `选 ${action.targetCount} 人后确认`
    : saved.length && !changed
      ? "已记下 · 只保存在这台手机上"
      : "今晚无需提交，可以记下你怀疑的人";
  return (
    <section className="pl-card" aria-label="今晚">
      <span className="pl-small">{action ? action.prompt : "今晚没有需要你提交的行动。"}</span>
      <span className="pl-picked" aria-live="polite">{big || "—"}</span>
      <div className="pl-grid" role="group" aria-label="号码">
        {[...room.seats]
          .sort((a, b) => a.number - b.number)
          .map((s) => (
            <button
              key={s.id}
              type="button"
              className={`pl-key ${s.id === me ? "me" : ""} ${s.alive ? "" : "dead"}`}
              aria-pressed={picked.includes(s.id)}
              aria-label={`${s.number} 号${s.id === me ? "，你自己" : ""}${s.alive ? "" : "，已死亡"}`}
              disabled={busy}
              onClick={() => pick(s.id)}
            >
              {s.number}
              {(s.id === me || !s.alive) && <small>{s.id === me ? "我" : "亡"}</small>}
            </button>
          ))}
      </div>
      <span className="pl-small">{status}</span>
      <button
        className="pl-confirm"
        disabled={busy || !ready || !changed}
        onClick={() => void confirm()}
      >
        {action ? "确认" : "记下"}
      </button>
    </section>
  );
}
