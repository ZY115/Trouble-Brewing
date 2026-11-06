# 前端接口：夜间反馈、座位笔记、说书人工作台

结束提示、最终裁定和精简复盘见 [结束与复盘接口](endgame-api.md)。

工作台数据随现有 Socket.IO `state` 推送，也包含在鉴权后的 `GET /api/rooms/:code/state` 中。设备连接状态只在 Socket.IO 的说书人视图中提供；历史对局按需加载，见下文。
类型见 `shared/workspace.ts`，命令格式见 `shared/commands.ts`。

## 1. 夜间结果立即显示

读取 `room.playerWorkspace.results`：只包含当前玩家已正式送达的裁定，**包括当前夜晚**。
每项提供 `actionId / night / prompt / targets / response / version / sentAt / history`。
`response` 是最新裁定，`history` 保留旧版。以 `actionId + version` 判断新结果或更正，不能只按条数判断。
旧存档的 `sentAt` 可能缺失。重连会返回本局全部已送达结果；新一局清空。

当前玩家界面由 `src/player/NightCard.tsx` 展示本夜行动，`src/player/InformationHistory.tsx` 展示已送达的信息及更正历史。`src/player/visibility.ts` 的 `revealedActions()` 返回所有 `DELIVERED` 行动，不再等到天亮才展示；相关行为由 `tests/player-visibility.test.ts` 验证。

说书人仍用 `send_action_response`（推荐）、`apply_action` 或 `review_action` 后 `deliver_action`。
仅审核、不发送的草稿不会出现在玩家接口中。发送时带 `expectedVersion`（玩家选择版本）和 `expectedContextVersion`（说书人看到的真实状态版本），避免按过时目标或状态裁定。
更正用 `correct_action_response`，带 `expectedResponseVersion` 和 `expectedContextVersion`。
这些私密结果与生死公布互相独立：夜间死亡仍由说书人决定何时公布，天亮默认统一公布。

## 2. 圆桌和笔记使用同一份座位数据

读取 `room.playerWorkspace.notebook`：

| 字段          | 用法                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `seats`       | 按号码排序；每项包含公开 `seat`、该座位的 `notes`、最新 `claimed` 自报身份和 `suspected` 个人判断 |
| `general`     | 未关联座位的文字笔记                                                                              |
| `archived`    | 已移除但可恢复的笔记                                                                              |
| `defaultDate` | 新建笔记默认的第几天/夜                                                                           |

圆桌选人和笔记详情都用稳定的 `seat.id`，不要以可变的号码当主键。
`notes` 最新保存的排在前面；每项包含 `entryId / kind / target / latest`。
`latest` 是当前版本；完整历史继续从 `room.notebook` 按 `entryId` 取 `revisions`。
历史日期用各版本的 `day / period`，历史号码用该版本的 `seatNumbers`，不要用当前号码替换旧记录。
身份标注只来自本人笔记，后端不会自动填真实身份，也不会读取其他玩家的笔记。

命令示例（装入 `command` 信封）：

```ts
// 选中座位后记一句话；不传 target 就是普通笔记。
{ type: "add_note", target: seatId, body: "他说第二天再解释" }

// 记录他自报共情者；只标注身份时可省略 info。
{ type: "add_note", target: seatId, roleId: "empath",
  source: "claimed", info: { number: "1" } }

// 我的判断。source 默认 suspected；body、info 可省略。
{ type: "add_note", target: seatId, roleId: "poisoner" }

// 修改已有判断，保留旧版；改身份而不传 info 会清空新版信息表。
{ type: "edit_notebook", entryId, expectedVersion: latest.version,
  patch: { roleId: "fortuneteller" } }

// 补充信息。info 整体替换，允许 {} 清空；字段定义沿用 shared/claims.ts。
{ type: "edit_notebook", entryId, expectedVersion: latest.version,
  patch: { info: { a: seatA, b: seatB, result: "否" } } }

// 移除标注但保留历史；恢复时改为 false。
{ type: "edit_notebook", entryId, expectedVersion: latest.version,
  patch: { archived: true } }
```

新建可选传 `day / period`，默认当前日期；编辑默认保留原记录日期，也可明确修改。
文字笔记必须有正文；身份笔记必须有目标和有效角色。不能通过编辑更换笔记对象或类型；请另建一条。
`claimed` 和 `suspected` 分别取当前未归档记录中最新的一条，不表示玩家真实身份。
归档最新记录后，如果还有更早的未归档记录，会显示更早的标注；若要清空某类标注，需归档该座位该类的所有记录。

`expectedVersion` 必须来自开始编辑时的版本，不能发送前用最新状态悄悄替换。
冲突时服务端拒绝覆盖：保留输入草稿，让玩家查看最新记录后再保存。
每次独立操作用新 `commandId`；网络重试同一操作复用原 `commandId`，并始终携带 `gameNo`。

等待入座时不返回 `playerWorkspace`，也禁止上述笔记命令。结束后可补记；续局清空当前笔记。玩家接口的 `pastNotebooks / pastPublicRecords / pastRecaps` 始终为空，不能把上一局内容带回玩家页面；同一局内的笔记修改历史仍保留。
保存笔记只向本人的连接推送，不向说书人或其他玩家发送笔记活动通知；不记电子笔记不会影响游戏推进。

## 3. 说书人集中工作台

读取 `room.storyteller.workbench`，仅说书人有此字段：

| 字段                 | 用法                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `nightQueue`         | 本夜清单按实际调整后的夜序排列；清单外手动行动附后；同一行动只计一次                                                       |
| `counts`             | `unstarted` 未开始、`manual` 说书人手动检查、`waiting` 等玩家选择、`ruling` 等说书人裁定、`completed` 已发送/取消/线下完成 |
| `nextRulingActionId` | 夜序中首个可裁定行动，仅建议，不自动执行                                                                                   |
| `seats`              | 按编号排序，关联该玩家本夜的 `actionIds` 和与说书人的全部 `messageIds`，附待裁定/待选择数量                                |
| `attention`          | 规则提醒 ID、首夜邪恶信息是否未发、过期状态数、尚未公开的死亡/复活座位、正在进行的投票 ID                                  |
| `phaseTransition`    | 当前阶段转换的核对内容、阻挡状态和版本；仅夜晚/白天提供                                                                    |

用 `actionIds` 从 `room.actions` 取完整行动、目标和 `reference`，用 `messageIds` 从 `room.messages` 取私聊；不含玩家之间的私聊或任何玩家笔记。
`reference.actual / evidence / warnings / suggestedResponse / truth / impaired` 仍用于先展示真实情况，再由说书人自由裁定。`truth` 是健康时应得的答案（失能时也保留），供复盘对照。不得把这些参考字段发送给玩家。
`APPROVED` 尚未发送，仍属于 `ruling`。取消和线下完成也计入 `completed`，显示具体完成方式时查看原行动 `status`。
进入白天后 `nightQueue` 为空、各项计数归零，座位卡仍可查看刚过去那夜的行动及私聊。

阶段确认弹窗用 `phaseTransition.publish`（天亮公布生死）或 `hold`（暂不公布）的 `lines / blocked / key`。
确认后发送：

```ts
{ type: "next_phase", publishLifeOnDawn: true,
  expectedPhaseVersion: workbench.phaseTransition.expectedPhaseVersion,
  expectedReviewKey: workbench.phaseTransition.publish.key }
```

暂不公布时必须同时改用 `publishLifeOnDawn: false` 和 `hold.key`。
提交的是用户在确认框里实际看到的快照；若期间状态变化，服务端拒绝旧确认，前端重新展示最新核对内容。
工作台只提供整理后的状态和建议，不额外强制流程、不自动裁定、不代替说书人结束游戏。


## 投票：全体倒计时、锁定、确认

1. `open_vote { nominator, nominee }` 开启举手，状态 `OPEN`。玩家用 `raise_hand { voteId, raised }` 随时举手或放下。
2. `start_countdown { voteId, seconds }`（3–60 秒）开始全体倒计时。视图里的 `liveVote.closesInMs` 是生成视图时剩余的毫秒数，前端按收到时刻自行倒数，不依赖手机时钟。到时服务器统一锁定，无需任何页面在线。
3. `lock_vote { voteId }` 立即锁定。锁定后状态 `COUNTING`，`counted` 是锁定时的手机举手（死者票已用者不计），玩家不能再改。
4. `finish_vote { voteId, voters }` 由说书人提交最终名单，可补上现场举手但没点手机的玩家，或去掉不该计入的票（例如主人没投票的管家）。服务器只校验名单中的玩家存在且有票，然后发布公开投票记录，状态 `FINISHED`。
5. `cancel_vote { voteId, reason }` 随时取消，不消耗死者票。

## 猎手开枪

`slayer_shot { shooter, target, kill }` 只能在白天、无进行中投票时由说书人提交。它发布一条公开记录（带 `shooter`、`target` 字段），`kill` 为真时登记目标死亡，复盘写成「8 号猎手向 1 号小恶魔开枪，1 号死亡。」。是否命中由说书人决定，前端按真实身份给出建议；同一玩家是否已开过枪可从公开记录的 `shooter` 判断。

## 恶魔假身份：说书人调整、恶魔分享、邪恶阵营认领

- `set_bluffs { bluffs: [3 个角色 ID] }`：仅说书人，首夜邪恶信息发出前可改。三个角色必须不同、是善良角色且不在场（也不能是酒鬼以为的身份）；未改动的格子允许暂时保留，便于逐个替换。
- 规则上只有恶魔拿到假身份。邪恶玩家的视图带 `evilBluffs { roles, claims, shared }`：恶魔始终能看到 `roles`；爪牙在恶魔分享前 `roles` 为空、`claims` 为空。
- `share_bluffs {}`：仅恶魔，分享一次。分享后爪牙能看到三个角色，同时在邪恶队友频道里以恶魔的名义发一条「三个假身份：…」。
- `claim_bluff { roleId }`：邪恶玩家认领其中一个，一人一个，不能和别人重复；`roleId: null` 放弃。爪牙需在恶魔分享后才能认领。说书人视图的 `storyteller.bluffClaims` 是当前认领情况。

## 连接恢复、设备状态与操作回执

- 连接成功或页面从后台返回后，发送 `sync`（回调参数），响应为 `{ ok: true, room }`。同步期间保留当前页面和草稿，但禁止发送游戏命令；收到当前连接的同步结果后再开放操作。用局数和 revision 拒绝倒退的数据包。
- 收到有效状态后发送 `state_ack`：`{ gameNo, revision }`。页面前后台变化发送 `visibility`：布尔值。仅说明设备接收状态，不说明人已阅读。
- 说书人 Socket.IO 视图新增 `storyteller.presence[seatId]`：`connection` 为 `foreground / background / offline`，`synced` 表示前台连接是否确认当前状态，`lastSeenAt` 是服务器时间戳。玩家视图不提供其他设备信息。
- 操作确认超时后，不盲目重发。重新同步后发送 `command_status`：`{ commandId }`，得到 `{ ok: true, applied: boolean }`。回执按登录凭据隔离，存入独立 SQLite 表，服务器重启后仍可核查；客户端只缓存待核查的 ID 和局数，不缓存命令正文。
- 普通“已发送”提示仅在服务器确认后出现。同步失败展示重试入口；跨局和撤销凭据后不能恢复旧视图或发送旧操作。

## 历史归档和继续上一局

实时 Socket.IO 与 HTTP state 的 `pastRecaps / pastPublicRecords` 不再携带旧局内容；说书人的 `archiveGames` 提供局数列表。`GET /api/rooms/:code/history/:gameNo` 使用说书人 Bearer 凭据，返回 `{ gameNo, recap, publicRecords, seats }`，不返回私人笔记。玩家没有历史接口权限。

`POST /api/host/latest` 正文为 `{ sessions, resume }`，`sessions` 是这个浏览器保存的说书人 `Session` 列表。

- 请求来自运行服务的电脑（127.0.0.1 / ::1）时，在所有房间里找最近有操作、且没有结束的一局；来自其他设备时，只在 `sessions` 里能以说书人身份打开的房间中找，避免同一网络里的玩家拿到说书人权限。
- `resume: false` 返回 `{ code, capacity, phase, day, activeAt }` 或 `null`。
- `resume: true` 返回可用的 `Session`：浏览器已有该房间的说书人凭据时原样返回，否则签发新的说书人凭据；没有可继续的对局时返回错误“没有未完成的对局”。

## 撤销与更正

说书人视图可提供 `undo: { revision, label }`。它只对应最近一次中毒、保护、醉酒或占卜误判标记；发送 `{ type: "undo_private_edit", expectedRevision: undo.revision }` 撤销，保留审计记录并更新裁定上下文。发生后续游戏操作后拒绝直接撤销，玩家的可选笔记操作不影响该入口。

已经发出的反馈继续使用 `correct_action_response`，保留历史版本与更正原因，玩家显示新版提醒。公开生死前核对具体名单；已经公开的信息通过更正处理，不能声称收回。
