# RoboCoding Desktop Design

Product name: **RoboCoding**. Subtitle: **by擎云机器人**.

This public product synopsis accompanies the existing DSH Desktop fork. The detailed internal design contract is maintained in the private `qy-robot/robocodingai-workspace` root `DESIGN.md`.

- Use a white/pale-blue interface with clear navy text and blue primary actions.
- Provide a simple task-start homepage, then a task workbench using the existing sidebar/main/rightbar slots.
- Reuse Harness conversations, tool outputs, approvals and file/diff previews rather than implementing another chat protocol.
- Keep the current task, workspace, selected model source, run/stop state and local action permissions visible.
- Distinguish connected devices from authorized device operations; do not represent sample telemetry as real data.
- Official cloud capabilities expose their purpose, input scope, status and necessary results. Their private knowledge is not distributed as local Skill bodies.
- Platform model usage and BYOK billing are distinct. User-supplied model endpoints do not receive company private knowledge.
- Retain compatibility mode as upstream's default client. Branded presentation and Linux adaptations use explicit desktop extension points.
- Support keyboard operation, Chinese input methods, clear focus, readable contrast and collapsible panels. Native titles/dialogs should follow platform behavior.

`robocodingai.product.json` reserves stable and beta application IDs, callback schemes and user-data names. These identifiers require runtime/installer integration and migration checks before release. Current application source and installation support remain at the pinned upstream baseline.

## Account and settings surfaces

- RoboCoding does not expose or load a plugin marketplace, including saved provider choices from older versions. Keep the robot skill market and device directory as separate product features.

- Keep a persistent account card directly above Settings in the sidebar footer. Show the real account and personal balance; a signed-out or unavailable service must not look authenticated.
- Use an upward account menu for account management, teams, balance refresh and sign-out. The collapsed sidebar retains an accessible avatar trigger.
- Keep account and model settings concise. Connection configuration is collapsed, and desktop diagnostics/terminal/restart actions live under More.
- Ask for team funding confirmation only after explicit selection. Preserve new-task scope and the rule that team funding never silently falls back to personal points.

## Skill picker readability (2026-09-15)

The composer picker uses a 460px theme-native surface, 20px heading and 16px main/control text. Search, selects and primary action have a 48px minimum height; skill rows have a 52px minimum. Robot and environment fields are stacked at every width. Remove the obsolete compact override and redundant introductory/selected-skill headings. Keep existing selection validation, command ownership and keyboard behavior. The popup shrinks to viewport width minus 32px and scrolls within the available height.

## 模型服务列表重排（2026-09-16）

- 服务标题、连接信息与管理操作组成紧凑页头；官方和自定义模型均使用纵向列表，名称左对齐，默认状态/操作右对齐。删除标签云、推荐装饰与渐变。
- 复用系统字体和现有深浅主题变量，不新增字体或依赖。面板12px圆角、模型行分隔线、稳定操作列。
- 先核对既有模型测试，beta实施后同步stable；验证默认切换/表单、两版类型构建，以及深浅主题和窄窗截图。

- 用户追加：各服务模型列表可收纳，自定义服务默认折叠，摘要显示数量及该服务的默认模型；官方列表初始展开，同样可折叠。原生details支持键盘，无额外状态存储。
