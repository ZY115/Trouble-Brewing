import type { NightAction, RoomView } from "../../shared/types";
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
          <label key={i}>
            号码 {i + 1}
            <select
              aria-label={`信息候选号码${i + 1}`}
              value={value.targets[i]}
              onChange={(e) =>
                fill({
                  ...value,
                  targets: value.targets.map((id, j) =>
                    j === i ? e.target.value : id,
                  ),
                })
              }
            >
              <option value="">请选择</option>
              {seats.map((s) => (
                <option
                  key={s.id}
                  value={s.id}
                  disabled={value.targets[1 - i] === s.id}
                >
                  {s.number}号
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          角色
          <select
            aria-label="首夜信息角色"
            value={value.roleId}
            onChange={(e) => fill({ ...value, roleId: e.target.value })}
          >
            <option value="">请选择</option>
            {ROLES.filter((r) => r.team === team).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
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
        随机项按真实身份生成，排除信息接收者；醉酒中毒或特殊登记时请自行修改最终裁定。
      </small>
    </section>
  );
}
