import { useState } from "react";
import Picker from "../ui/Picker";
import type { ExecutionRecord, RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { roleName } from "../../shared/roles";
import { localKey, useLocalState } from "../localState";

function Editor({
  room,
  entry,
  send,
}: {
  room: RoomView;
  entry: ExecutionRecord;
  send: Send;
}) {
  const seat = room.seats.find((s) => s.id === entry.seatId)!;
  const version = room.storyteller!.contextVersion;
  const [draft, set, clear] = useLocalState(
    localKey(room, `execution:${entry.id}`),
    {
      died: entry.died,
      voided: entry.voided ?? false,
      alive: seat.alive,
      reason: "",
      version,
    },
  );
  const [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>更正 / 撤销这次处决</summary>
      <p className="muted">
        原记录会保留。已经告诉送葬者的信息需要另外更正。
      </p>
      {draft.version !== version && (
        <p className="notice">
          状态已变化。
          <button onClick={() => set({ ...draft, version })}>
            已核对最新状态
          </button>
        </p>
      )}
      <Picker
        label="处决结果"
        value={draft.voided ? "void" : draft.died ? "died" : "survived"}
        options={[
          { value: "died", label: "因处决死亡" },
          { value: "survived", label: "处决未导致死亡" },
          { value: "void", label: "撤销这次处决" },
        ]}
        onChange={(v) => set({ ...draft, voided: v === "void", died: v === "died" })}
        clearable={false}
      />
      <Picker
        label="当前生死"
        value={String(draft.alive)}
        options={[
          { value: "true", label: "存活" },
          { value: "false", label: "死亡" },
        ]}
        onChange={(v) => set({ ...draft, alive: v === "true" })}
        clearable={false}
      />
      <label className="field">
        公开更正原因
        <input
          aria-label="处决更正原因"
          maxLength={200}
          value={draft.reason}
          onChange={(e) => set({ ...draft, reason: e.target.value })}
        />
      </label>
      <button
        disabled={
          busy ||
          !draft.reason.trim() ||
          draft.version !== version ||
          room.phase === "ENDED"
        }
        onClick={async () => {
          setBusy(true);
          if (
            await send({
              type: "correct_execution",
              executionId: entry.id,
              died: draft.died,
              voided: draft.voided,
              alive: draft.alive,
              reason: draft.reason,
              expectedContextVersion: draft.version,
            })
          )
            clear();
          setBusy(false);
        }}
      >
        确认更正处决记录
      </button>
    </details>
  );
}
export default function ExecutionHistory({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const entries = room.storyteller?.executions ?? [];
  if (!entries.length) return null;
  return (
    <details className="panel">
      <summary>
        处决记录与更正 ·{" "}
        {
          entries.filter((e) => !entries.some((n) => n.supersedes === e.id))
            .length
        }{" "}
        项
      </summary>
      {[...entries].reverse().map((e) => {
        const old = entries.some((n) => n.supersedes === e.id);
        return (
          <article
            className={`execution-entry ${old ? "superseded" : ""}`}
            key={e.id}
          >
            <strong>
              第 {e.day} 天 ·{" "}
              {room.seats.find((s) => s.id === e.seatId)?.number} 号 ·{" "}
              {e.voided ? "已撤销" : e.died ? "处决死亡" : "处决未导致死亡"}
              {old ? "（旧版）" : ""}
            </strong>
            <p className="muted">
              当时真实身份：{roleName(e.actualRoleId)}
            </p>
            {!old && <Editor room={room} entry={e} send={send} />}
          </article>
        );
      })}
    </details>
  );
}
