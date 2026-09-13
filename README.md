<div align="center">

# 弹幕点歌姬

**本机运行、面向直播的第三方 B 站弹幕点歌工具**

观众发送「点歌 歌名」入队，主播在 Electron 窗口中播放；支持 OBS 捕获窗与透明桌面歌词。

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)](https://nodejs.org/)
[![CI](https://github.com/Daybreak-Frontline/daybreak-danmaku-ji/actions/workflows/ci.yml/badge.svg)](https://github.com/Daybreak-Frontline/daybreak-danmaku-ji/actions/workflows/ci.yml)

作者：[长楠](https://github.com/Daybreak-Frontline)（@DaybreakCN）

README 更新：2026-09-13 · 当前版本 `2.4.0`

</div>

---

## 仓库导航

| 我想要…… | 快速入口 |
| --- | --- |
| 下载与运行 | [从源码运行](#从源码运行) · [便携包](#便携包) · [首次配置](#首次配置) |
| 了解能力 | [项目定位](#项目定位) · [核心能力](#核心能力) · [弹幕命令](#弹幕命令) |
| 阅读文档 | [扩展点](docs/EXTENSION_POINTS.md) · [安全说明](SECURITY.md) · [版权声明](NOTICE) |
| 开发与构建 | [构建](#从源码运行) · [开发](#开发) · [目录结构](#目录结构) |
| 参与项目 | [参与贡献](#参与贡献) · [提交 Issue](https://github.com/Daybreak-Frontline/daybreak-danmaku-ji/issues) |

## 项目定位

弹幕点歌姬是运行在主播本机上的桌面点歌工具，覆盖弹幕点歌、队列播放、OBS 捕获与桌面歌词。界面与部分播放能力源自 [Musiche](https://github.com/HeHang0/Musiche)（Apache-2.0）；本仓库仅保留点歌姬相关实现。

- **直播使用优先**：弹幕点歌、切歌、礼物点歌、闲时歌单覆盖开播主流程。
- **本机播放优先**：Electron 桌面窗口、队列出队、多音源搜索与 BV 点播。
- **直播呈现优先**：多种 OBS 捕获窗、入队播报、透明桌面歌词。
- **隐私克制**：登录 Cookie 仅加密保存在本机 `data/`，不写入仓库，也不随便携包分发。

> [!IMPORTANT]
> 应用默认设置面向通用场景。首次使用请进入 **设置 → 账号与直播** 完成扫码登录，再在 **设置 → 点歌** 中按直播间规则调整冷却、礼物与闲时歌单。

## 核心能力

| 模块 | 能力 |
| --- | --- |
| 弹幕点歌 | 连接直播间、识别「点歌 / 切歌」、冷却、黑名单、权限规则 |
| 音源 | 网易云、QQ 音乐、咪咕（需扫码登录）；BV 号点播 B 站音频，无需开启哔哩哔哩搜索 |
| 队列 | 观众点歌入队、播放完成出队、闲时歌单（闲时曲目不计入待播数量） |
| 礼物 | 礼物点歌、礼物切歌、电池阈值 |
| 捕获窗 | 静态窗与滚动窗；新曲入队时播报一次；供直播姬 / OBS 窗口捕获 |
| 桌面歌词 | 透明置顶、字号与颜色、描边与光晕；播放栏「词」或 `/overlay/lyric` |
| 日志 | 按日保存运行记录，可配置保留天数与体积上限 |
| 账号 | B 站与音乐平台扫码登录；Cookie 加密存储于 `data/` |

## 弹幕命令

| 弹幕 | 说明 |
| --- | --- |
| `点歌 歌名` | 在已启用的音源中搜索并加入队列 |
| `点歌 BVxxxxxxxxxx` | 按 BV 号点播 B 站音频 |
| `切歌` | 切换至下一首（是否允许由设置决定） |

## 键盘快捷键

焦点位于输入框或按钮时不触发。顶栏「?」可展开按钮说明。

| 按键 | 说明 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| `←` `→` | 快退 / 快进 5 秒 |
| `↑` `↓` | 调节音量 |
| `M` | 静音 |
| `Shift` + `←` `→` | 上一首 / 下一首 |

## 运行环境

| 项目 | 说明 |
| --- | --- |
| 系统 | Windows 10 / 11（当前桌面端以 Windows 为发布目标） |
| 运行时 | [Node.js](https://nodejs.org/) 22.5 或更高版本，需支持 `node --experimental-sqlite` |
| 网络 | 本机可访问 B 站及所选音乐平台 |
| 登录 | B 站扫码；网易云 / QQ 音乐 / 咪咕扫码 |

## 从源码运行

```bash
git clone https://github.com/Daybreak-Frontline/daybreak-danmaku-ji.git
cd daybreak-danmaku-ji

npm install
cd web
npm install
npm run build-only
cd ..

# 仅启动本机 API（浏览器访问 http://127.0.0.1:54821 ）
npm run server

# 启动 Electron 桌面窗口（同时启动本机 API）
npm run desktop
```

开发界面时可另行启动前端热更新：

```bash
cd web
npm start
```

Vite 开发服务器默认监听 `127.0.0.1:5173`，API 仍为 `54821`。请避免与已运行的便携包占用同一端口。

若 npm 需要 HTTP 代理，将 `.npmrc.example` 复制为 `.npmrc` 后修改地址。请勿提交 `.npmrc`。

## 首次配置

1. 打开应用，在 **设置 → 账号与直播** 扫码登录 B 站，并登录至少一个音乐平台。
2. 填写直播间房间号，于播放页点击「连接弹幕」。
3. 在 **设置 → 点歌** 中启用点歌，并按需配置冷却、礼物与闲时歌单。
4. 在播放页选择捕获窗样式并打开；直播姬或 OBS 使用「窗口捕获」选取该窗口。
5. 捕获窗默认无边框，右键可显示边框以便拖动或关闭。

播放页将捕获窗分为静态与滚动两类。滚动窗循环展示当前曲目及随后 3 首；新曲入队时先滚动一次「已入队」。待播数量不包含正在播放的曲目，亦不包含闲时歌单。

桌面歌词字体、颜色、描边、透明与置顶选项位于 **设置 → 点歌** 页底部。

## 配置

可选环境变量见 [`.env.example`](./.env.example)：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `54821` | 本机 API 端口 |
| `MUSICHE_DATA` | `./data` | SQLite 与加密 Cookie 目录 |
| `MUSICHE_SESSION_SECRET` | 内置默认值 | Cookie 加密密钥；共享设备时请修改 |

音源注册与命令钩子见 [docs/EXTENSION_POINTS.md](./docs/EXTENSION_POINTS.md)。

## 便携包

| 项目 | 说明 |
| --- | --- |
| 文件名 | `musiche-danmaku-ji-portable-<version>.zip` |
| 内容 | 内含 Node 与 Electron，解压后运行 `start.bat` |
| 数据 | 允许包含空的 `data/`，禁止包含已登录数据 |
| 升级 | 先关闭新旧进程，再将旧版 `data` 覆盖至新包 |
| 端口 | 默认 `54821`，请勿与本机另一实例同时占用 |

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 桌面壳 | Electron |
| 本机 API | Node.js 22（`--experimental-sqlite`）、原生 SQLite |
| 界面 | Vue 3、Element Plus、Vite、Pinia |
| 实时通道 | Server-Sent Events、WebSocket（弹幕） |
| 存储 | 本机 `data/`、Cookie 静态加密 |

## 目录结构

```text
daybreak-danmaku-ji/
├── electron/            # Electron 主进程（启动本机 API 与桌面窗口）
├── server/              # 本机 HTTP API、弹幕、曲库、队列、登录
├── web/                 # Vue 3 界面（播放、搜索、设置、捕获窗）
├── docs/                # 扩展点说明
├── .github/workflows/   # 构建检查
├── NOTICE               # 上游 Musiche 版权声明
└── LICENSE              # Apache-2.0
```

本地开发目录中可能残留上游 Musiche 的 `mobile/`、`windows/` 等路径，已由 `.gitignore` 排除。运行时生成的 `data/` 同样不纳入版本库。

## 开发

```bash
npm run server:check   # 检查本机 API 与 Electron 入口语法
cd web
npm run build-only     # 构建界面
npm run type-check     # Vue / TypeScript 类型检查
```

修改界面后，需将 `web/dist` 同步至正在运行的实例并刷新浏览器。修改 `server/` 后需重启 API 进程。

## 参与贡献

欢迎提交 Issue 与 Pull Request。

1. Fork 本仓库。
2. 从 `main` 创建 `feature/xxx` 或 `fix/xxx` 分支。
3. 保持改动聚焦，并完成必要验证。
4. 提交 PR，说明改动目的、影响范围与验证结果。

提交前请确认：

1. 未包含 `data/`、`.env`、`.npmrc` 或任何 Cookie。
2. 前端变更已在 `web/` 下验证；服务端变更已执行 `npm run server:check`。
3. 说明变更原因，而非仅列举文件。

## 致谢

本项目依赖并衍生自以下开源项目：

| 项目 | 用途 |
| --- | --- |
| [Musiche](https://github.com/HeHang0/Musiche) | 界面与部分播放能力（Apache-2.0，HeHang） |
| [Vue](https://github.com/vuejs/core) | 界面框架 |
| [Element Plus](https://github.com/element-plus/element-plus) | 组件库 |
| [Electron](https://github.com/electron/electron) | 桌面窗口 |
| [Vite](https://github.com/vitejs/vite) | 前端构建 |
| [Pinia](https://github.com/vuejs/pinia) | 状态管理 |

版权声明见 [NOTICE](./NOTICE)。如有遗漏，欢迎通过 Issue 或 PR 补充。

## 免责声明

> [!CAUTION]
>
> 1. 本项目按 Apache-2.0 开源；使用、修改与分发时请遵守许可证及相关法律法规。
> 2. 本项目与哔哩哔哩、网易云音乐、QQ 音乐、咪咕音乐均无官方关系。数据来自各平台公开接口或用户登录后的正常访问能力，版权归对应权利方所有。
> 3. 登录信息仅加密保存在本机，不会写入仓库或便携分发包。
> 4. 请仅在自己的直播间使用，并遵守各平台服务条款。
> 5. 如涉及版权或权益问题，请通过 Issue 联系维护者。

## 许可证

[Apache License 2.0](./LICENSE)

本仓库衍生自 Musiche，已在 [NOTICE](./NOTICE) 中保留其版权与许可声明。

---

<div align="center">

Made by [长楠](https://github.com/Daybreak-Frontline)

</div>
