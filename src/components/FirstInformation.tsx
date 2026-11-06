import type { NightAction, RoomView } from "../../shared/types";
import Picker, { roleOptions, seatOptions } from "../ui/Picker";
import {
  firstInformationTeam,
  randomFirstInformation,
} from "../../shared/first-information";
import { ROLES, roleName } from "../../shared/roles";
import { localKey, useLocalState } from "../localState";
export default function FirstInformation({
  room,
  action,
  onResponse,
}: {
  room: RoomView;
  action: NightAction;
  onResponse: (value: string) => void;
}) {
  const team = firstInformationTeam(action.referenceRoleId ?? "");
  const [value, set] = useLocalState(
    localKey(room, `pair-information:${action.id}`),
    { targets: ["", ""], roleId: "" },
  );
  if (!team) return null;
  const seats = room.seats.filter((s) => s.id !== action.seatId);
  const fill = (v: typeof value) => {
    set(v);
    if (v.targets.every(Boolean) && new Set(v.targets).size === 2 && v.roleId)
      onResponse(
        `${v.targets.map((id) => `${room.seats.find((s) => s.id === id)?.number}号`).join("、")}中有一人是${roleName(v.roleId)}`,
      );
    else onResponse("");
  };
  return (
    <section className="first-information">
      <strong>两个号码 + 一个角色</strong>
      <div className="form-grid">
        {[0, 1].map((i) => (
          <Picker
            key={i}
            label={`号码 ${i + 1}`}
            value={value.targets[i]}
            options={seatOptions(seats, [value.targets[1 - i]])}
            onChange={(v) =>
              fill({
                ...value,
                targets: value.targets.map((id, j) => (j === i ? v : id)),
              })
            }
            placeholder="请选择"
          />
        ))}
        <Picker
          label="角色"
          value={value.roleId}
          options={roleOptions(ROLES.filter((r) => r.team === team))}
          onChange={(v) => fill({ ...value, roleId: v })}
          placeholder="请选择"
        />
      </div>
      <button
        disabled={!randomFirstInformation(room, action, () => 0)}
        onClick={() => {
          const pair = randomFirstInformation(room, action);
          if (pair) fill(pair);
        }}
      >
        随机生成一组并填入
      </button>
      {team === "outsider" && (
        <button onClick={() => onResponse("0（没有外来者）")}>
          填入没有外来者
        </button>
      )}
      <small>
        随机结果按真实身份生成；中毒、醉酒或特殊登记时请自己改。
      </small>
    </section>
  );
}
