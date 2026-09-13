# 安全说明

这是运行在主播本机上的桌面点歌姬。登录 Cookie 只加密写在本机 `data/` 里，仓库和便携分发包都不应带上这份目录。

请不要提交：

- `data/`、`*.sqlite`、任何 Cookie 或扫码会话
- `.npmrc`、`.env` 以及本机代理地址
- 便携包里已经用过的 `data` 目录

发现安全问题请到本仓库开 GitHub Issue，或直接联系 [长楠 @DaybreakCN](https://github.com/DaybreakCN)。不要在 Issue 里粘贴 Cookie、SESSDATA、MUSIC_U 或完整登录库。
