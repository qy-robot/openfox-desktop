# RoboCodingAI

by擎云机器人

This is the RoboCodingAI product fork of [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop). Product repository: `qy-robot/robocodingai-desktop`.

Repository initialization preserves the original desktop implementation, licenses, dependency identities and pinned Harness runtime. `robocodingai.product.json` records the confirmed brand and reserved platform identifiers; the application UI and installers do not consume those values yet.

- Product development branch: `robo/main`; upstream history remains on `master`.
- Desktop UI and Electron Host remain in the existing desktop plugin packages; shared changes start in beta and are synchronized into stable.
- Windows, macOS and Linux are product targets. Linux adaptation and three-platform packaging are not completed by this initialization.
- Harness remains the original official pinned submodule. Do not change the submodule alone and claim the vendored runtime was upgraded.
- Company knowledge runs in a separate private service and is not included in this public repository or the App bundle.

Original [README](README.md), [repository instructions](AGENTS.md) and licensing remain applicable. Internal product coordination is in the private `qy-robot/robocodingai-workspace` repository.
