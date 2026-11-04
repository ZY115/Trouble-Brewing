import { useState } from "react";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
/** One part at a time: pending invitations, the new-group form, or the open group. */
export default function GroupControls({
  room,
  send,
  selected,
  part,
}: {
  room: RoomView;
  send: Send;
  selected: string;
  part: "invites" | "create" | "group";
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("小组聊天");
  const [invitees, setInvitees] = useState<string[]>([]);
  const [invitee, setInvitee] = useState("");
  const [busy, setBusy] = useState(false);
  const me = room.viewer.seatId!;
  const group = room.groups.find((g) => g.id === selected);
  const pending = room.invitations.filter(
    (i) => i.to === me && i.status === "pending",
  );
  const seatName = (id: string) =>
    room.seats.find((s) => s.id === id)?.nickname ?? "玩家";
  const ended = room.phase === "ENDED";
  async function act(c: Parameters<Send>[0]) {
    setBusy(true);
    const ok = await send(c);
    setBusy(false);
    return ok;
  }
  if (room.storyteller) return null;
  if (part === "group" && !group) return null;
  if (part === "invites" && !pending.length) return null;
  return (
    <section className="group-controls">
      {part === "invites" && pending.map((i) => (
        <div className="invitation-row" key={i.id} role="status">
          <span>
            {seatName(i.from)} 邀请你加入「{i.groupName}」
          </span>
          <button
            disabled={busy || ended}
            onClick={() =>
              void act({
                type: "respond_invite",
                invitationId: i.id,
                accept: true,
              })
            }
          >
            加入
          </button>
          <button
            disabled={busy || ended}
            onClick={() =>
              void act({
                type: "respond_invite",
                invitationId: i.id,
                accept: false,
              })
            }
          >
            不加入
          </button>
        </div>
      ))}
      {part === "create" && (
        <button className="group-new" disabled={ended} onClick={() => setCreating(!creating)}>
          {creating ? "收起" : "新建群聊"}
        </button>
      )}
      {part === "create" && creating && (
        <form
          className="group-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act({ type: "create_group", name, invitees })) {
              setCreating(false);
              setInvitees([]);
            }
          }}
        >
          <label>
            群名称
            <input
              aria-label="群名称"
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>邀请玩家（对方确认后加入）</legend>
            <div className="seat-checkboxes">
              {room.seats
                .filter((s) => s.id !== me)
                .map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={invitees.includes(s.id)}
                      onChange={(e) =>
                        setInvitees(
                          e.target.checked
                            ? [...invitees, s.id]
                            : invitees.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.nickname}
                  </label>
                ))}
            </div>
          </fieldset>
          <button
            className="primary"
            disabled={busy || ended || !name.trim() || !invitees.length}
          >
            创建并发送邀请
          </button>
        </form>
      )}
      {part === "group" && group && (
        <div className="group-members">
          <p>成员：{Object.keys(group.members).map(seatName).join("、")}</p>
          <div className="inline-form">
            <select
              aria-label="邀请加入当前群的玩家"
              value={invitee}
              onChange={(e) => setInvitee(e.target.value)}
            >
              <option value="">选择邀请对象</option>
              {room.seats
                .filter((s) => !(s.id in group.members))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nickname}
                  </option>
                ))}
            </select>
            <button
              disabled={!invitee || busy || ended}
              onClick={async () => {
                if (
                  await act({
                    type: "invite_group",
                    groupId: group.id,
                    seatId: invitee,
                  })
                )
                  setInvitee("");
              }}
            >
              邀请
            </button>
            <button
              disabled={busy || ended}
              onClick={() =>
                void act({ type: "leave_group", groupId: group.id })
              }
            >
              退出群聊
            </button>
          </div>
          {room.invitations
            .filter(
              (i, index, all) =>
                i.groupId === group.id &&
                !(i.to in group.members) &&
                !all
                  .slice(index + 1)
                  .some(
                    (next) => next.groupId === group.id && next.to === i.to,
                  ),
            )
            .map((i) => (
              <small className="invitation-status" key={i.id}>
                {seatName(i.to)}：
                {
                  {
                    pending: "等待回复",
                    accepted: "已退出",
                    declined: "已拒绝",
                    cancelled: "已取消",
                  }[i.status]
                }
              </small>
            ))}
          <small>加入后可见新消息。</small>
        </div>
      )}
    </section>
  );
}
