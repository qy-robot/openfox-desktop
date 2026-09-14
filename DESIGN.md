# RoboCodingAI Desktop Design

Product name: **RoboCodingAI**. Subtitle: **by擎云机器人**.

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
