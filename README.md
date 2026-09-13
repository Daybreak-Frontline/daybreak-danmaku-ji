# 弹幕点歌姬

面向 B 站直播的本机点歌工具。观众通过弹幕发送「点歌 歌名」加入队列，主播在 Electron 窗口中播放；播放页可另开 OBS 捕获窗与透明桌面歌词。

作者：[长楠](https://github.com/Daybreak-Frontline)（@DaybreakCN）

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)](https://nodejs.org/)
[![CI](https://github.com/Daybreak-Frontline/daybreak-danmaku-ji/actions/workflows/ci.yml/badge.svg)](https://github.com/Daybreak-Frontline/daybreak-danmaku-ji/actions/workflows/ci.yml)

界面与部分播放能力源自 [Musiche](https://github.com/HeHang0/Musiche)（Apache-2.0）。本仓库仅保留点歌姬相关实现：本地 Node API、Vue 界面与 Electron 壳。版权声明见 [NOTICE](./NOTICE)。

本项目为个人直播工具，与哔哩哔哩、网易云音乐、QQ 音乐、咪咕音乐均无官方关系。使用时请遵守各平台服务条款，并仅用于自己的直播间。

## 目录

- [功能](#功能)
- [运行环境](#运行环境)
- [从源码运行](#从源码运行)
- [首次配置](#首次配置)
- [弹幕命令](#弹幕命令)
- [键盘快捷键](#键盘快捷键)
- [捕获窗与桌面歌词](#捕获窗与桌面歌词)
- [配置](#配置)
- [便携包](#便携包)
- [目录结构](#目录结构)
- [开发](#开发)
- [安全](#安全)
- [致谢](#致谢)
- [许可证](#许可证)
- [参与贡献](#参与贡献)

## 功能

- 连接 B 站直播间弹幕，识别「点歌」「切歌」
- 搜索并播放网易云、QQ 音乐、咪咕（需在设置中扫码登录对应平台）
- 支持以 BV 号点播 B 站音频，无需开启哔哩哔哩搜索
- 点歌队列、播放完成出队、闲时歌单
- 礼物点歌 / 礼物切歌、电池阈值、歌曲黑名单
- 多种 OBS 捕获窗（静态与滚动）；新曲入队时播报一次
- 透明桌面歌词，可配置字号与颜色
- 运行日志按日保存，可配置保留天数与体积上限
- 登录 Cookie 仅加密存储于本机 `data/`，不纳入版本库

## 运行环境

- Windows 10 / 11（当前桌面端以 Windows 为发布目标）
- [Node.js](https://nodejs.org/) 22.5 或更高版本（需支持 `node --experimental-sqlite`）
- 本机可访问 B 站及所选音乐平台

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

## 弹幕命令

| 弹幕 | 说明 |
| --- | --- |
| `点歌 歌名` | 在已启用的音源中搜索并加入队列 |
| `点歌 BVxxxxxxxxxx` | 按 BV 号点播 B 站音频 |
| `切歌` | 切换至下一首（是否允许由设置决定） |

## 键盘快捷键

焦点位于输入框或按钮时不触发。

| 按键 | 说明 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| `←` `→` | 快退 / 快进 5 秒 |
| `↑` `↓` | 调节音量 |
| `M` | 静音 |
| `Shift` + `←` `→` | 上一首 / 下一首 |

顶栏「?」可展开按钮说明。

## 捕获窗与桌面歌词

播放页将捕获窗分为静态与滚动两类。滚动窗循环展示当前曲目及随后 3 首；新曲入队时先滚动一次「已入队」。待播数量不包含正在播放的曲目，亦不包含闲时歌单。

桌面歌词可通过播放栏「词」按钮打开，或访问 `/overlay/lyric`。字体、颜色、描边、透明与置顶选项位于 **设置 → 点歌** 页底部。

## 配置

可选环境变量见 [`.env.example`](./.env.example)：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `54821` | 本机 API 端口 |
| `MUSICHE_DATA` | `./data` | SQLite 与加密 Cookie 目录 |
| `MUSICHE_SESSION_SECRET` | 内置默认值 | Cookie 加密密钥；共享设备时请修改 |

音源注册与命令钩子等扩展点见 [docs/EXTENSION_POINTS.md](./docs/EXTENSION_POINTS.md)。

## 便携包

对外分发包名为 `musiche-danmaku-ji-portable-<version>.zip`，内含 Node 与 Electron，解压后运行 `start.bat`。

- 包内允许包含空的 `data/` 目录，禁止包含已登录的数据
- 升级时请先关闭新旧进程，再将旧版 `data` 目录覆盖至新包
- 便携包默认端口为 `54821`，请勿与本机另一实例同时占用

## 目录结构

```text
├── electron/           Electron 主进程（启动本机 API 与桌面窗口）
├── server/             本机 HTTP API、弹幕、曲库、队列、登录
├── web/                Vue 3 界面（播放、搜索、设置、捕获窗）
├── docs/               扩展点说明
├── .github/workflows/  构建检查
├── NOTICE              上游 Musiche 版权声明
└── LICENSE             Apache-2.0
```

本地开发目录中可能残留上游 Musiche 的 `mobile/`、`windows/` 等目录，上述路径已由 `.gitignore` 排除。运行时生成的 `data/` 同样不纳入版本库。

## 开发

```bash
npm run server:check   # 检查本机 API 与 Electron 入口语法
cd web
npm run build-only     # 构建界面
npm run type-check     # Vue / TypeScript 类型检查
```

修改界面后，需将 `web/dist` 同步至正在运行的实例并刷新浏览器。修改 `server/` 后需重启 API 进程。

## 安全

- Cookie 仅加密存储于 `data/`。本机升级时复制该目录即可，无需重新扫码
- 仓库、Pull Request、Issue 与便携分发包均不得包含 `data/`
- 安全问题请参阅 [SECURITY.md](./SECURITY.md)，请勿在 Issue 中粘贴 Cookie 或完整登录数据

## 致谢

- [Musiche](https://github.com/HeHang0/Musiche)（HeHang，Apache-2.0）：界面与部分播放能力
- [Vue](https://github.com/vuejs/core)、[Element Plus](https://github.com/element-plus/element-plus)、[Electron](https://github.com/electron/electron) 及其他依赖见各目录 `package.json`

## 许可证

[Apache License 2.0](./LICENSE)

本仓库衍生自 Musiche，已在 [NOTICE](./NOTICE) 中保留其版权与许可声明。

## 参与贡献

欢迎提交 Issue 与 Pull Request。提交前请确认：

1. 未包含 `data/`、`.env`、`.npmrc` 或任何 Cookie
2. 前端变更已在 `web/` 下验证；服务端变更已执行 `npm run server:check`
3. 说明变更原因，而非仅列举文件
