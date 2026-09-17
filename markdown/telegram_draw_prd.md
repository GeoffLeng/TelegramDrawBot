# 抽奖 Bot（Telegram Draw Bot）产品需求文档（PRD）

## 1. 文档信息与产品定位

- **产品名称**：Telegram Draw Bot（抽奖 Bot / 抽奖活动子系统）
- **所属系统**：TGactivitybot 运营管理中台
- **产品版本**：v1.0.0
- **产品定位**：面向 Web3 / Telegram 社群与频道的轻量级、自动化、防作弊的抽奖与福利分发工具。
- **目标用户**：
  - **前台社群用户**：Telegram 社区普通成员、KOL、持币者，通过一键点击即时参与抽奖。
  - **后台运营管理者**：社群管理员、项目方增长运营、活动策划，负责活动的编排、门槛设置、开奖干预及履约发奖。
- **核心价值**：
  - 解决 Telegram 官方 Giveaway 门槛单一、无法自定义加群/加频道组合校验的痛点。
  - 规避依赖外部第三方向中心化平台授权的安全隐患与网络卡顿。
  - 提供“全自动开奖”与“指定内定 + 随机补齐”的双轨制运营能力，满足商务合作与日常增长的双重诉求。

---

## 2. 总体功能架构设计

系统从逻辑上划分为五层，各层之间数据单向流转与异步解耦：

1. **管理控制层（Web Dashboard）**
   - 引擎休眠总控（置灰与阴影门板保护）
   - 活动全流程管理（创建、富文本编辑、复制为模板、删除）
   - 开奖干预与中奖者指定（防误触确认、名单内定、配额校验）
   - 中奖者履约管理（状态标记、筛选检索、CSV 报表导出）
   - Bot 参数配置（独立 Token 测试 Ping、9 项交互提示语模板全英文化管理）

2. **准入审查与风控层（Gatekeeping & Anti-Spam Engine）**
   - Telegram 社群/频道在籍成员身份强校验（`creator`/`admin`/`member`/`restricted`）
   - 白名单（Whitelisted UIDs / Handles）资格审查
   - 1.5 秒频率防刷控制（Per-User Debounce Mutex）
   - 单活动单用户唯一性报名校验

3. **任务调度与开奖裁决层（Scheduler & Draw Engine）**
   - 60 秒轮询调度器（以东八区北京时间 UTC+8 为唯一时区基准）
   - Fisher-Yates 纯随机洗牌抽奖算法
   - 混合指定抽奖算法（指定优先锁定 + 剩余席位全随机补齐）
   - 零参与者流标处理与未满额流拍补偿机制

4. **Telegram 通道与交互层（Telegram Bot Gateway）**
   - 纯净活动正文推送（Quill HTML 安全转换为 Telegram HTML 实体）
   - 内联按钮交互响应（Telegram Callback Query）
   - 原广播消息按钮安全封板（开奖后秒级转换为不可点击的 `[🔒 Ended]` 状态）
   - 聚合排版式中奖喜报广播（按奖品层级聚合展示，支持 4096 字符防溢出截断）

5. **本地隔离数据持久层（SQLite Storage）**
   - 采用独立数据库实例（`./drawbot.db`）物理隔离主系统数据
   - 启用 WAL 日志模式与 16MB 缓存，保障高并发写入不锁库

---

## 3. 模块划分与详细功能规格

### 3.1 抽奖活动生命周期管理模块
- **状态定义**：
  - `DRAFT（草稿）`：新建但未推送到 Telegram，仅在后台可见，可任意编辑、删除。
  - `ACTIVE（进行中）`：已成功推送至指定 Telegram 群组/频道，内联参与按钮有效，接收用户报名。
  - `DRAWING（开奖中）`：开奖逻辑执行期间的瞬态保护锁，阻止并发写入与用户重复请求。
  - `ENDED（已结束）`：已产生中奖者名单，原 Telegram 广播按钮已封板，群内已公布开奖公告。
- **模板克隆工作流（Copy as Template）**：
  - 位于每个活动卡片内容区的右上角，提供 `📋 复制` 按钮。
  - 点击后一键克隆选中活动的所有核心参数（活动名称自动拼接 `(Copy)`、富文本描述、封面图 URL、目标群组/Topic、门槛群组/频道、奖项梯队、自定义公告模板）。
  - 自动清空活动 ID、参与者名单、中奖记录与自动开奖时间，进入全新草稿创建流程。

### 3.2 活动编排与富文本配置模块
- **基础元数据**：
  - 活动内部名称（`internalName`）：用于后台标识及群内中奖喜报标题。
  - 封面图链接（`coverImageUrl`）：支持外部图片直链，卡片具备自适应折叠布局，图片损坏时自动隐藏并不影响功能。
- **富文本正文（Quill Editor）**：
  - 替代原生 `<textarea>`，集成粗体（Bold）、斜体（Italic）、下划线（Underline）、删除线（Strike）、标题（H1-H3）、有序/无序列表（List）、超链接（Link）及清除格式功能。
  - 纯净发布机制：移除系统自动追加的奖品列表与截止时间尾缀，Telegram 推送内容完全以管理员排版为准。
- **奖品梯队配置（Prize Tiers）**：
  - 支持多档位奖项组合（例如：1 份 50 USDT，5 份 10 Golden Keys）。
  - 动态添加/删除行，自动计算并展示总设奖份数。
- **时间机制（东八区北京时间）**：
  - 开始时间（可选）：若配置，未到时间用户点击将收到未开始弹窗。
  - 截止时间（必填）：前端表单严格校验必须大于当前北京时间。
  - 自动开奖时间（Auto Draw Time，可选）：开启定时开奖时必填，到达设定时间自动由调度器触发开奖。

### 3.3 准入风控与门槛审查模块
- **频道/社群联动门槛（Gatekeeping）**：
  - 支持“必须加入指定群组”与“必须加入指定频道”。
  - 兼容 `@username`、`https://t.me/...`、`t.me/...` 及负数数字 ID（`-100...`）等多种输入格式。
  - 用户在 Telegram 点击参与时，Bot 实时调用 `getChatMember` 审查成员在籍状态（必须处于 `creator`、`administrator`、`member` 或 `restricted` 状态）。
- **白名单机制（Whitelisted Participants）**：
  - 支持录入特定 Telegram UID 或无 `@` 用户名列表，仅名单内用户具备抽奖资格。
- **防刷与限频控制（Anti-Spam）**：
  - 单用户点击报名执行 1.5 秒 Debounce 互斥拦截。
  - 对已成功报名的用户，再次点击即时弹出已加入提示，杜绝重复占位。

### 3.4 裁决与中奖生成模块
- **防误触开奖弹窗（3 按钮设计）**：
  - 点击“开奖”按钮不再直接结算，而是弹出确认模态框，直观呈现活动名称、奖品总数与当前达标人数。
  - 选项一：`⚡ 立刻开奖 (全随机)` —— 执行纯随机抽奖并广播。
  - 选项二：`🎯 指定开奖 (手动分配)` —— 进入中奖者指定工作台。
  - 选项三：`取消 (返回)` —— 安全退出。
- **指定中奖者（内定）双轨工作台**：
  - 管理员可从已报名的真实成员列表中，挑选特定用户绑定至特定奖品。
  - 配额强校验：单个奖品分配数不能超过该奖品总数，总指定人数不能超过总奖项总数；单个用户不得重复中奖。
  - 双轨执行流：
    - **路径 A（立即执行）**：点击 `⚡ 立刻开奖`，指定者直接锁定中奖，剩余奖品由 Fisher-Yates 算法从非指定报名者中随机抽满，立即发布公告。
    - **路径 B（预存定时执行）**：点击 `⏰ 按照 Auto Draw 时间开奖`，指定者名单安全预存到数据库中，等待设定时间到达后由后台自动开奖发布，期间运营无需守候。
  - 提供一键 `清空指定` 按钮，随时可撤销指定并恢复 100% 纯随机模式。
- **异常参与情况处理**：
  - **零参与者**：活动平稳结束，原消息按钮转换为 `[🔒 Ended]`，向群内发送“因无有效参与者报名，未产生中奖者”的流标通告。
  - **参与人数少于总奖品数**：所有人均获奖，剩余奖品自动声明流拍，并在公告末尾透明公示流拍份数。

### 3.5 Telegram 消息通道与喜报排版
- **原消息按键锁死**：开奖完成后，原活动广播消息的 `[🎉 Join Lucky Draw]` 按键实时修改为 `[🔒 Ended]`。
- **被动自愈机制**：若因网络波动导致原消息按键修改失败，任何用户在开奖后点击该按钮时，系统会借由回调事件被动触发补救性封板。
- **聚合式中奖喜报（Winner Announcement）**：
  - 祝贺标题支持自定义模板，默认提供高辨识度英文版。
  - 移除了每个获奖者名前的杂乱 emoji，奖项与标题强制空行隔开。
  - 奖品归类聚合展示：`<b>奖品名称</b>: @user1 @user2`。
  - 消息长度安全守护：若中奖名单过长，在达到 3800 字符时自动截断并引导至后台查看，防止触发 Telegram 4096 字符硬上限导致发送失败。

### 3.6 后台控制台与系统设置模块
- **引擎休眠阴影门板（Sleep State Shadow Curtain）**：
  - 提供全局总控开关（绿色运行 / 灰色休眠）。
  - 休眠模式下，除开关本身外，控制台其余所有卡片与操作按钮 100% 置灰禁用，并覆盖带有脉冲呼吸灯的半透明遮罩；开启后瞬时恢复全彩交互。
- **中奖者履约管理（Winners Management）**：
  - 集中展示所有活动的中奖明细（中奖活动、用户 Handle、Telegram UID、中奖项、开奖时间）。
  - 支持单键切换发奖履约状态（待发放 / 已发放）。
  - 支持带 UTF-8 BOM 的 CSV 全量导出（杜绝 Excel 打开乱码），包含审计专用的 `EventID` 与时间戳。
- **Bot 设置与连通性测试（Bot Settings）**：
  - 独立 Bot Token 持久化管理（直接保存在 SQLite 中，不写入 `.env`）。
  - 具备独立长轮询守护与同 Token 冲突消除机制。
  - 一键向指定群组/Topic 发送测试 Ping 消息，排查权限与网络状态。
  - 提供 9 大交互场景的英文提示语模板自定义修改（点击即存即生效）。

---

## 4. 页面结构与关键交互流程

### 4.1 页面布局结构
1. **顶部导航与模块入口**：
   - 全局顶部导航：`Dashboard` / `User Management` / `Push Bot` / `Lucky Draw`。
2. **Lucky Draw 主控制台界面**：
   - **顶部操作栏**：品牌标识、状态徽章、`开关`（Slider Switch）、`Winners List`、`Bot Settings`、`➕ New Draw`、`🔄 Refresh`。
   - **数据指标面板（KPI Bar）**：总活动数、进行中活动、总参与人次、已发放奖品数。
   - **活动筛选选项卡**：`All` / `Active` / `Draft` / `Ended`。
   - **活动卡片流（Card Grid）**：
     - 卡片顶部：封面海报（自适应）、右上角常驻状态角标（`ACTIVE`/`DRAFT`/`ENDED`）。
     - 卡片内容区：活动标题、右上角 `📋 复制` 按钮、富文本描述摘要、奖项预览、社群与起止时间信息、实际参与人数统计（若有指定中奖者，高亮标注 `🎯 已预设 X 位中奖者`）。
     - 卡片底部动作栏：
       - 草稿状态：`编辑` / `发布到 Telegram` / `删除`。
       - 进行中状态：`开奖 (Draw Winners Now)` / `终止活动`。
       - 已结束状态：`查看中奖者` / `补发广播 (Re-announce)` / `删除`。
3. **核心模态框体系**：
   - `#modal-draw-campaign`：活动创建/编辑表单（Quill 编辑器、奖项梯队动态行、门槛设置）。
   - `#modal-draw-confirm`：防误触开奖三键确认框与中奖者指定工作台。
   - `#modal-draw-winners`：中奖者明细查看、筛选与 CSV 导出框。
   - `#modal-draw-settings`：Bot Token 配置、连通性测试、9 项提示语模板编辑框。

---

## 5. 核心数据字典

### 5.1 活动表（`lotteries`）
| 字段名 | 类型 | 约束 | 说明 |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | 活动唯一标识，形如 `lottery_1789542084026_2skkf` |
| `internal_name` | TEXT | NOT NULL | 活动内部名称 |
| `description` | TEXT | NOT NULL | Quill 富文本 HTML 代码 |
| `cover_image_url` | TEXT | NULL | 封面海报直链地址 |
| `target_chat_id` | TEXT | NOT NULL | 推送目标 Telegram 群组或频道 ID/Handle |
| `target_topic_id` | TEXT | NULL | 目标群组内论坛话题 ID（Thread ID） |
| `required_channel_id`| TEXT | NULL | 参与门槛：必须加入的频道 Handle/Link |
| `required_group_id` | TEXT | NULL | 参与门槛：必须加入的群组 Handle/Link |
| `allowed_chat_ids` | TEXT | NULL | 白名单 UID 或 Handle 列表（JSON 序列化） |
| `draw_mode` | TEXT | DEFAULT 'AUTO'| 开奖模式：`MANUAL`（纯手动） / `AUTO`（定时自动） |
| `start_time` | TEXT | NOT NULL | 活动开始生效时间（ISO 8601，东八区） |
| `end_time` | TEXT | NOT NULL | 活动截止报名时间（ISO 8601，东八区） |
| `auto_draw_time` | TEXT | NULL | 自动开奖执行时间（ISO 8601，东八区） |
| `prizes` | TEXT | NOT NULL | 奖品梯队定义（JSON Array：`[{name, count}]`） |
| `status` | TEXT | DEFAULT 'DRAFT'| 活动状态：`DRAFT` / `ACTIVE` / `DRAWING` / `ENDED` |
| `telegram_message_id`| INTEGER| NULL | 广播消息在 Telegram 中的 Message ID |
| `designated_winners`| TEXT | NULL | 预设指定的获奖名单（JSON Array） |
| `announcement_template`| TEXT | NULL | 自定义中奖公告头部文本 |
| `created_at` | INTEGER | NOT NULL | 毫秒级创建时间戳 |

### 5.2 参与者流水表（`participants`）
| 字段名 | 类型 | 约束 | 说明 |
| :--- | :--- | :--- | :--- |
| `lottery_id` | TEXT | NOT NULL | 关联的活动主键 ID |
| `chat_id` | TEXT | NOT NULL | 参与者的 Telegram UID（字符串） |
| `username` | TEXT | NULL | 参与者 Telegram 用户名（无 `@`） |
| `first_name` | TEXT | NULL | Telegram 名 |
| `last_name` | TEXT | NULL | Telegram 姓 |
| `account_age` | TEXT | NULL | 基于 UID 估算的账号注册时长画像 |
| `joined_at` | INTEGER | NOT NULL | 毫秒级入库时间戳 |

### 5.3 中奖者快照表（`winners`）
| 字段名 | 类型 | 约束 | 说明 |
| :--- | :--- | :--- | :--- |
| `lottery_id` | TEXT | NOT NULL | 关联的活动主键 ID |
| `chat_id` | TEXT | NOT NULL | 获奖者的 Telegram UID |
| `username` | TEXT | NULL | 获奖者 Telegram 用户名 |
| `first_name` | TEXT | NULL | 获奖者名 |
| `last_name` | TEXT | NULL | 获奖者姓 |
| `prize_name` | TEXT | NOT NULL | 所中的具体奖品名称 |
| `won_at` | INTEGER | NOT NULL | 毫秒级中奖开奖时间戳 |
| `claim_status` | TEXT | DEFAULT 'Pending'| 发奖履约状态：`Pending`（待发） / `Claimed`（已发） |

### 5.4 系统配置表（`bot_settings`）
| 键名（Key） | 默认值（Value） | 业务含义说明 |
| :--- | :--- | :--- |
| `draw_module_enabled` | `1` | 抽奖引擎运行开关（`1` 开启全彩，`0` 休眠置灰） |
| `drawbot_token` | `""` | DrawBot 专用 Bot Token 凭据 |
| `msg_success_join` | `🎉 Entry confirmed! Good luck!` | 首次报名成功弹窗提示 |
| `msg_already_joined` | `ℹ️ You have already joined!` | 重复点击报名弹窗提示 |
| `msg_not_started` | `⏳ This giveaway has not started yet!` | 活动未到开始时间拦截提示 |
| `msg_ended` | `⚠️ This giveaway has ended!` | 活动已开奖/已截止拦截提示 |
| `msg_entries_closed` | `⚠️ Entries for this giveaway are closed!` | 开奖计算中拦截提示 |
| `msg_og_only` | `🔒 This Lucky Draw is exclusive to Whitelisted OGs.` | 非白名单成员拦截提示 |
| `msg_must_join_group_channel`| `⚠️ You must join the required {target} to participate!` | 未满足加群加频道门槛提示 |
| `msg_rate_limit` | `⏳ Please slow down...` | 1.5 秒高频防刷限频提示 |
| `msg_join_failed` | `⚠️ Failed to join. Please try again later.` | 系统异常或网络故障报错提示 |

---

## 6. 异常用例与边界防护规格

1. **Telegram API 频控与封锁（HTTP 429 Too Many Requests）**：
   - *防护机制*：长轮询与开奖消息发送均包含重试退避逻辑；中奖喜报长度超限保护，控制在 3800 字符内，避免因单包过大被拒绝。
2. **Bot 无管理员发帖/置顶权限**：
   - *防护机制*：点击发布时，若 Telegram API 返回权限不足错误，系统捕获异常并弹窗向管理员报告精准错误，活动状态维持 `DRAFT`，不产生残损垃圾数据。
3. **活动无任何人参与时的到期结算**：
   - *防护机制*：开奖函数内设 0 参与者特殊分支，平稳将状态更新为 `ENDED`，释放定时任务，并主动调用封板接口与流标通告接口，杜绝服务崩溃。
4. **人工指定名额时参与者退群或注销**：
   - *防护机制*：指定下拉框数据来源于 `participants` 真实快照；开奖时直接读取快照结算，无论开奖瞬间用户是否退群，均能正常完成开奖并产出对账单。
5. **服务器断电/崩溃后的定时开奖补偿**：
   - *防护机制*：服务重启并初始化调度器时，系统自动扫描并追溯执行历史遗漏的到期活动，确保定时抽奖不会因重启而永久卡死。

---

## 7. 外部依赖与环境兼容

- **运行环境**：Node.js v20+ / TypeScript 5+。
- **存储驱动**：SQLite3（通过 `sqlite` 封装异步操作），纯本地文件存储，不依赖外部付费云服务。
- **通信框架**：GrammY (Telegram Bot Framework for Node.js)。
- **富文本支撑**：Quill.js v1.3.7（采用深色主题定制）。
- **时区环境**：强制东八区（`Asia/Shanghai` / UTC+8）。
