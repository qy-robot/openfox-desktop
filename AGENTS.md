# DSH Desktop repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root Yarn `4.18.0` release through Corepack.
- Initialize the pinned upstream checkout with `git submodule update --init --recursive`.
- Install root dependencies with `corepack yarn install --immutable`.

## Build, run, and verify

- Start the desktop development workflow with `corepack yarn dev`.
- Build the desktop package with `corepack yarn build`.
- Run unit tests with `corepack yarn test`.
- Run type checking with `corepack yarn typecheck`.
- Run the complete headless gate with `corepack yarn check`.
- Develop and validate Desktop feature changes in `dsh-plugin-desktop-beta/` first, then synchronize shared changes into `dsh-plugin-desktop/` while preserving declared variant differences. Before committing or pushing shared Desktop changes, run `corepack yarn check:desktop-variants` and validate both affected packages; neither package automatically inherits the other's source edits.
- Run upstream operations through the root scripts, such as `corepack yarn upstream:build`.

- `deepseek-harness/` is a pinned upstream Git submodule. Never edit files inside it from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root Yarn release with `nodeLinker: node-modules`.
- The upstream submodule keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, whose Yarn portable-shell commands enter the submodule before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md).

## AI 进度交接约定

- 开始工作先读仓库根目录 `log.md`，再核对 Git 分支、提交和工作树；日志是交接线索，实际代码与验证结果优先。
- 完成一个可验证阶段、改变方案、发现阻塞，以及结束任务或切换 AI 前，更新 `log.md`。长任务有实质进展时及时记录，无变化不刷日志。
- 每条记录写明带时区时间、执行者、任务/分支/基线提交、已完成、验证证据、未完成/阻塞、下一步；不要把计划写成完成状态。
- 持续更新“当前状态”，历史记录按时间追加。纠错应新增说明，不能抹去历史或覆盖其他 AI 的记录。
- 多 AI 并行时各记自己的任务范围；同一工作树指定一个整合者写日志，其余提交交接内容。不同分支合并时保留双方记录并复核当前状态；不要用覆盖一方的方式解决冲突。
- 日志与对应工作一起提交。跨仓库任务先更新组件日志并推送组件，再由工作区维护者更新总日志和 gitlink；独立克隆组件的贡献者无需访问私有工作区。
- 日志不得包含密码、Token、验证码、客户原始数据或私有知识正文；公开 Fork 只写可公开的进度。
