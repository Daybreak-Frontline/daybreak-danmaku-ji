# 扩展口

点歌、播放、捕获窗行为应保持稳定。下面这些口已经留好，以后加功能时往里接，不要再从业务代码里硬拆。

## 音源注册表 `server/sources.mjs`

```js
import { registerSource } from './sources.mjs';

registerSource({
  id: 'bili',
  label: '哔哩哔哩',
  aliases: ['b站', 'bilibili'],
  search, lookup, playUrl, lyric
});
```

已注册 `qq` / `cloud` / `migu` / `bili`。`splitOrderKeyword` 会先识别 `BV` 号（固定以 BV 开头，12 位），再解析音源别名和纯数字歌曲 ID。BV 点播不依赖是否开启 B站搜索。

## 命令钩子 `server/command-hooks.mjs`

空实现。用 `registerHook(name, fn)` 挂上即可：

| 钩子 | 何时触发 | 以后谁接 |
| --- | --- | --- |
| `onOrderAccepted` | 点歌入队成功 | 弹幕回执 |
| `onOrderRejected` | 点歌被拒（缺歌名、权限、队列满、黑名单、未找到） | 回执 / 消歧 |
| `onSkip` | 实际切歌（弹幕、礼物切歌都走这里） | 切歌提示 |

## 快照扩展袋 `snapshot.extensions`

SSE `snapshot` 固定带 `extensions: {}`。前端类型是 `DanmakuSnapshot.extensions`。未知键直接忽略。以后本场榜、通知条放这里，不要改 `current` / `queue` 语义。

## 列表来源 `origin`

前端 `ActiveListKind` 仍只有 `request` | `library`。第三种来源（例如 B 站 BV）走音源注册表，不要先在前端加枚举。
