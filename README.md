# 弹幕点歌姬

面向 B 站直播的本机点歌姬。观众在直播间发「点歌 歌名」入队，主播用 Electron 桌面窗播放；播放页可以再开给 OBS 用的捕获窗，以及透明桌面歌词。

制作人：[长楠](https://github.com/DaybreakCN)（@DaybreakCN）

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)](https://nodejs.org/)
[![CI](https://github.com/DaybreakCN/daybreak-danmaku-ji/actions/workflows/ci.yml/badge.svg)](https://github.com/DaybreakCN/daybreak-danmaku-ji/actions/workflows/ci.yml)

界面与部分播放能力来自 [Musiche](https://github.com/HeHang0/Musiche)（Apache-2.0）。本仓库只保留点歌姬这条线：本地 Node API + Vue 界面 + Electron 壳。致谢见 [NOTICE](./NOTICE)。

本项目是个人直播工具，和 B 站、网易云、QQ 音乐、咪咕都没有官方关系。请遵守各平台服务条款，仅在自己的直播间使用。

## 目录

- [能做什么](#能做什么)
- [环境](#环境)
- [从源码运行](#从源码运行)
- [第一次使用](#第一次使用)
- [弹幕命令](#弹幕命令)
- [键盘快捷键](#键盘快捷键)
- [捕获窗和桌面歌词](#捕获窗和桌面歌词)
- [配置](#配置)
- [便携包](#便携包)
- [项目结构](#项目结构)
- [开发](#开发)
- [安全](#安全)
- [致谢](#致谢)
- [许可证](#许可证)
- [参与贡献](#参与贡献)

## 能做什么

- 连接 B 站直播间弹幕，识别「点歌 / 切歌」
- 搜索并播放网易云、QQ 音乐、咪咕（需在设置里扫码登录对应平台）
- 观众直接发 BV 号点播 B 站音频，不必打开哔哩哔哩搜索开关
- 观众点歌队列、播完出队、闲时歌单
- 礼物点歌 / 礼物切歌、电池阈值、歌曲黑名单
- 多种 OBS 捕获窗（静态 + 滚动），入队时播报一次
- 透明桌面歌词，字号和颜色可在设置里改
- 运行日志按日保存，可设置保留天数和体积
- 登录 Cookie 只加密存在本机 `data/`，不会写进仓库

## 环境

- Windows 10 / 11（当前桌面端按 Windows 使用）
- [Node.js](https://nodejs.org/) 22.5 或更新（需要 `node --experimental-sqlite`）
- 本机可访问 B 站和所选音乐平台

## 从源码运行

```bash
git clone https://github.com/DaybreakCN/daybreak-danmaku-ji.git
cd daybreak-danmaku-ji

npm install
cd web
npm install
npm run build-only
cd ..

# 只开本机 API（浏览器访问 http://127.0.0.1:54821 ）
npm run server

# 或开 Electron 桌面窗（会自己拉起 API）
npm run desktop
```

开发时改界面可以另开前端热更新：

```bash
cd web
npm start
```

Vite 开发服默认走 `127.0.0.1:5173`，API 仍是 `54821`。不要和已经在跑的便携包抢同一个端口。

npm 需要代理时，把 `.npmrc.example` 复制为 `.npmrc` 再改地址。不要把 `.npmrc` 提交上去。

## 第一次使用

1. 打开应用，到 **设置 → 账号与直播** 扫码登录 B 站，并登录至少一个音乐平台。
2. 填写直播间房间号，到播放页点「连接弹幕」。
3. 在 **设置 → 点歌** 里打开点歌，按需要设冷却、礼物和闲时歌单。
4. 到播放页选一种捕获窗样式，点打开；直播姬 / OBS 用「窗口捕获」选这个窗口。
5. 捕获窗默认无边框，右键可以呼出边框以便拖动或关闭。

## 弹幕命令

| 弹幕 | 作用 |
| --- | --- |
| `点歌 歌名` | 在已开启的音源中搜索并入队 |
| `点歌 BVxxxxxxxxxx` | 按 BV 号点播 B 站音频 |
| `切歌` | 切到下一首（是否允许由设置决定） |

## 键盘快捷键

输入框或按钮聚焦时不会触发。

| 按键 | 作用 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| `←` `→` | 快退 / 快进 5 秒 |
| `↑` `↓` | 音量 |
| `M` | 静音 |
| `Shift` + `←` `→` | 上一首 / 下一首 |

顶栏问号可以展开按钮指引。

## 捕获窗和桌面歌词

播放页把捕获窗分成静态和滚动两组。滚动窗会循环当前曲和接下来 3 首；有人点歌时先滚一次「已入队」。待播数量不含正在播的歌，也不含闲时歌单。

桌面歌词在播放栏点「词」，或打开 `/overlay/lyric`。字体、颜色、描边、透明、置顶在 **设置 → 点歌** 最底部。

## 配置

可选环境变量见 [`.env.example`](./.env.example)：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `54821` | 本机 API 端口 |
| `MUSICHE_DATA` | `./data` | SQLite 与加密 Cookie 目录 |
| `MUSICHE_SESSION_SECRET` | 内置默认值 | Cookie 加密密钥，共享机器请改掉 |

音源注册、命令钩子等扩展口见 [docs/EXTENSION_POINTS.md](./docs/EXTENSION_POINTS.md)。

## 便携包

对外分发用 `musiche-danmaku-ji-portable-<version>.zip`：内置 Node 和 Electron，解压后双击 `start.bat`。

- 包里可以有空的 `data/`，**不能**带已经登录过的库
- 旧用户升级：先关掉新旧窗口，把旧版整个 `data` 覆盖进新包
- 便携包默认端口 `54821`，不要和本机另一份同时开

## 项目结构

```text
├── electron/           Electron 主进程，拉起本机 API 和桌面窗
├── server/             本机 HTTP API、弹幕、曲库、队列、登录
├── web/                Vue 3 界面（播放、搜索、设置、捕获窗）
├── docs/               扩展口说明
├── .github/workflows/  构建检查
├── NOTICE              上游 Musiche 致谢
└── LICENSE             Apache-2.0
```

本地开发目录里可能还留着上游 Musiche 的 `mobile/`、`windows/` 等文件夹，它们**不会**进入 Git。运行时产生的 `data/` 同样不会进入 Git。

## 开发

```bash
npm run server:check   # 语法检查本机 API 和 Electron 入口
cd web
npm run build-only     # 只构建界面
npm run type-check     # Vue / TS 类型检查
```

改界面后需要把 `web/dist` 同步到正在跑的本机实例，再刷新浏览器。改 `server/` 后需要重启 API 进程。

## 安全

- Cookie 只加密存在 `data/`，本机升级靠复制这个目录，不要重新扫码
- 开源仓库、PR、Issue、便携分发包都不要带 `data/`
- 发现安全问题请看 [SECURITY.md](./SECURITY.md)，不要在 Issue 里粘贴 Cookie 或完整登录库

## 致谢

- [Musiche](https://github.com/HeHang0/Musiche)（HeHang，Apache-2.0）：界面与部分播放能力
- [Vue](https://github.com/vuejs/core)、[Element Plus](https://github.com/element-plus/element-plus)、[Electron](https://github.com/electron/electron) 等依赖见各目录的 `package.json`

## 许可证

[Apache License 2.0](./LICENSE)

本仓库衍生自 Musiche，已在 [NOTICE](./NOTICE) 保留其版权与许可声明。

## 参与贡献

欢迎 Issue 和 Pull Request。提交前请：

1. 不要提交 `data/`、`.env`、`.npmrc` 或任何 Cookie
2. 前端改动在 `web/` 下自测，服务端改动跑 `npm run server:check`
3. 说明「为什么改」，而不是只列文件
