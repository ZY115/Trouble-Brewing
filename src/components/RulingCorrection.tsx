import { useState } from "react";
import type { NightAction, RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import { localKey, useLocalState } from "../localState";

export default function RulingCorrection({
  room,
  action,
  send,
}: {
  room: RoomView;
  action: NightAction;
  send: Send;
}) {
  const version = action.responseVersion ?? 1,
    context = room.storyteller!.contextVersion;
  const [draft, set, clear] = useLocalState(
    localKey(room, `correct-ruling:${action.id}`),
    { response: action.response ?? "", reason: "", version, context },
  );
  const [busy, setBusy] = useState(false);
  const stale = draft.version !== version || draft.context !== context;
  return (
    <details className="action-resolution">
      <summary>更正这条反馈</summary>
      <p className="muted">
        旧版保留并标记已失效；新裁定和说明仅发送给这位玩家。
      </p>
      {stale && (
        <p className="notice">
          反馈或状态已变化，草稿保留。
          <button onClick={() => set({ ...draft, version, context })}>
            已核对最新状态
          </button>
        </p>
      )}
      <label className="field">
        更正后的裁定
        <textarea
          aria-label="更正后的裁定"
          maxLength={2000}
          value={draft.response}
          onChange={(e) => set({ ...draft, response: e.target.value })}
        />
      </label>
      <label className="field">
        给玩家的更正说明
        <input
          aria-label="给玩家的更正说明"
          maxLength={200}
          value={draft.reason}
          onChange={(e) => set({ ...draft, reason: e.target.value })}
        />
      </label>
      <button
        disabled={
          busy || stale || !draft.response.trim() || !draft.reason.trim()
        }
        onClick={async () => {
          setBusy(true);
          if (
            await send({
              type: "correct_action_response",
              actionId: action.id,
              response: draft.response,
              reason: draft.reason,
              expectedResponseVersion: draft.version,
              expectedContextVersion: draft.context,
            })
          )
            clear();
          setBusy(false);
        }}
      >
        确认发送更正
      </button>
    </details>
  );
}
