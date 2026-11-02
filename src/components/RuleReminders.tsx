import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
export default function RuleReminders({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  const st = room.storyteller!,
    [busy, setBusy] = useState(false);
  async function act(c: Parameters<Send>[0]) {
    setBusy(true);
    await send(c);
    setBusy(false);
  }
  if (!["FIRST_NIGHT", "OTHER_NIGHT", "DAY"].includes(room.phase)) return null;
  return (
    <div className="rule-reminders">
      {!!st.staleConditions.length && (
        <section className="notice" aria-label="到期状态提醒">
          <strong>
            {room.phase === "DAY"
              ? "天亮：保护标记已到期"
              : "入夜：核对上一轮中毒和保护"}
          </strong>
          <p>
            {st.staleConditions
              .map(
                (x) =>
                  `${room.seats.find((s) => s.id === x.seatId)?.number}号${x.condition === "poisoned" ? "中毒" : "保护"}`,
              )
              .join("、")}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void act({
                type: "clear_expired_conditions",
                expectedContextVersion: st.contextVersion,
              })
            }
          >
            一键清除这些到期标记
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void act({
                type: "keep_expired_conditions",
                expectedContextVersion: st.contextVersion,
              })
            }
          >
            本次保留
          </button>
        </section>
      )}
      {st.notices.map((n) => (
        <section className="notice rule-notice" role="alert" key={n.id}>
          <strong>
            需要裁定 · {n.kind === "demon" ? "恶魔死亡 / 继任" : "胜负检查"}
          </strong>
          <p>{n.text}</p>
          {n.canConfirmSelfKill && (
            <details>
              <summary>补记自杀传位原因</summary>
              <button
                disabled={busy}
                onClick={() =>
                  void act({
                    type: "confirm_self_kill",
                    deathId: n.deathId!,
                    confirmed: true,
                    expectedContextVersion: st.contextVersion,
                  })
                }
              >
                确认此次死亡是小恶魔能力自杀
              </button>
            </details>
          )}
          {!!n.candidates.length && (
            <details>
              <summary>确认继任人选</summary>
              <p>
                更新真实/认知身份并私密通知本人；白天继任会补入夜间清单，自杀传位当夜不再击杀。
              </p>
              {n.candidates.map((id) => (
                <button
                  disabled={busy}
                  key={id}
                  onClick={() =>
                    void act({
                      type: "promote_imp",
                      seatId: id,
                      deathId: n.deathId!,
                      confirmed: true,
                      expectedContextVersion: st.contextVersion,
                    })
                  }
                >
                  确认 {room.seats.find((s) => s.id === id)?.number}{" "}
                  号成为小恶魔
                </button>
              ))}
            </details>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void act({
                type: "resolve_notice",
                noticeId: n.id,
                expectedContextVersion: st.contextVersion,
              })
            }
          >
            已核对，暂不据此结束
          </button>
          <details>
            <summary>结束本局</summary>
            <button disabled={busy} onClick={() => void act({ type: "end" })}>
              已确认胜负，结束本局
            </button>
          </details>
        </section>
      ))}
      {room.phase === "FIRST_NIGHT" && !st.evilInfoSent && (
        <section className="notice">
          <button
            disabled={busy}
            onClick={() =>
              void act({
                type: "send_evil_info",
                expectedContextVersion: st.contextVersion,
              })
            }
          >
            一键发送首夜邪恶信息与假身份
          </button>
          <small>
            爪牙收到恶魔与其他爪牙号码；恶魔收到爪牙号码与假身份。同时开放邪恶频道。
          </small>
        </section>
      )}
    </div>
  );
}
