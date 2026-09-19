# OpenFox 本地技能联调 / Local skills development

Desktop extended / advanced 模式保留原输入框，在工具栏增加“技能”。兼容模式保留上游客户端。
The extended and advanced modes add a skills picker to the existing composer. Compatibility mode retains the upstream client.

1. 独立启动本地技能服务，接口为 `GET /v1/catalog`、`POST /v1/demo-runs`。默认地址 `http://127.0.0.1:8765`。
   Start the local skills service separately with those two endpoints.
2. 在本仓库执行 / From this repository:

   ```sh
   ROBO_SKILLS_URL=http://127.0.0.1:8765 corepack yarn dev:beta
   ```

3. 先选择本地工作区，再在输入框点击“技能”，搜索或按机器人、任务分类筛选；机器人技能需确认型号与环境。选择后填写示例文本，使用原发送按钮提交；分析结果显示在输入框下方。
   Choose a workspace, open the skills picker, filter by robot or category, confirm the environment where required, then submit sample text with the existing send button. Results appear below the composer.
4. 移除技能标签可恢复普通聊天；失败保留选择与草稿。不同会话分别保存选择。
   Remove the selected skill to return to ordinary chat. Errors retain the selection and draft. Selections are isolated by session.

本地示例只分析文字，不支持附件，不调用模型或控制设备，不产生模型费用。目录从服务读取，Desktop 不包含技能定义。未配置服务时会显示未连接；关闭选择器即可继续聊天。
Local demos analyze text only, accept no attachments, and invoke no models or devices. The catalog is fetched from the service; skill definitions are not bundled into Desktop. Close an unavailable picker to continue chatting.

`ROBO_SKILLS_URL` 只接受显式端口的 `http://127.0.0.1:port` 或 `http://localhost:port`。这是本地开发接口，尚不支持生产服务、账号和钱包。
The service URL accepts only loopback HTTP with an explicit port. Production hosting, account access and billing are separate work.

本次改动更新界面字样，不迁移安装 ID、用户数据目录或更新通道。技能运行结果目前随会话页面保留，重启后不作为历史消息恢复。
Display branding changes do not migrate installation identities, user data or update channels. Demo results are transient and are not restored as chat history after a restart.
