# 架构说明

## 目标

当前版本只实现 B 站普通视频下载，但把「站点相关逻辑」和「通用下载/合并 UI」分开，方便后续增加抖音、TikTok、小红书、Instagram、X 等站点。

## 模块

```text
content script
  └─ 读取页面 URL，显示面板，发消息
        │ chrome.runtime.sendMessage
        ▼
service worker
  ├─ bilibili.js：view / playurl / WBI 签名 / 清晰度与编码选择
  ├─ 生成下载任务，写入 chrome.storage.session
  └─ 打开 downloader.html（合并模式）
        │ chrome.storage.session
        ▼
downloader page
  ├─ 拉取视频轨、音频轨
  ├─ ffmpeg.wasm 执行 -c copy 封装
  └─ chrome.downloads 保存 MP4
```

### `src/content/content.js`

- 只匹配 `https://www.bilibili.com/video/*`。
- 从 URL 解析 `bvid` / `aid` / `p`。
- 在 Shadow DOM 中渲染浮动按钮和面板，避免与 B 站页面样式冲突。
- 轮询 URL 变化，兼容 B 站单页应用切换视频。
- 只负责展示与发消息，不直接访问 B 站接口，也不处理大文件。

### `src/background/service-worker.js`

消息入口，负责：

- `BILI_GET_VIDEO`：读取视频信息 + 获取可选清晰度，返回给面板。
- `BILI_PREPARE_DOWNLOAD`：
  - `merge`：生成合并任务并打开下载页；
  - `separate`：生成分离轨道任务并打开下载页；
  - `audio`：生成仅音频任务并打开下载页。
- 文件名清洗、UTF-8 长度限制、任务过期清理。

### `src/background/bilibili.js`

封装 B 站相关逻辑：

- `view` 接口获取标题、UP 主、分 P、`cid`。
- WBI 签名请求 `x/player/wbi/playurl`。
- 请求 `fnval=4048`，覆盖 DASH、HDR、4K、8K、杜比、AV1 等能力位。
- 按 `id` 分组清晰度，选择与用户请求最接近的清晰度。
- 按编码偏好选择 H.264 / HEVC / AV1，优先 H.264 以兼容播放器。
- 返回主地址与备用地址。

WBI 签名：

1. 请求 `x/web-interface/nav` 获取 `img_url`、`sub_url`。
2. 取文件名作为 `imgKey`、`subKey`。
3. 按固定 64 位置换表重排，截取 32 位 `mixinKey`。
4. 参数按 key 排序、URL 编码，拼接 `wts`，计算 `md5(query + mixinKey)` 得到 `w_rid`。

`src/shared/md5.js` 是为该签名实现的无依赖 MD5，不用于安全场景。

### `src/downloader/downloader.js`

- 从 `chrome.storage.session` 读取任务，按 `mode` 分支：
  - `merge`：下载两轨并调用 ffmpeg.wasm 合并；
  - `separate`：下载两轨后分别保存为视频/音频文件；
  - `audio`：只下载音频并保存为 M4A。
- 依次拉取视频轨、音频轨；支持主地址失败后尝试 `backupUrl`。
- 把两个 `Uint8Array` 写入 ffmpeg.wasm 的 MEMFS。
- 执行：

```text
ffmpeg -i video.m4s [-i audio.m4s] -map 0:v:0 [-map 1:a:0] -c copy \
  [-tag:v hvc1] -movflags +faststart -metadata title=... output.mp4
```

- 校验输出是否包含 `moov` 索引，避免把未完成的半成品当成成功。
- 通过 `chrome.downloads.download` 保存 Blob，并监听下载状态。
- 失败时提供「分别下载」兜底。

> 所有模式都通过下载页的 `fetch` 拉流，而不是把签名 URL 直接交给 `chrome.downloads`。部分 B 站 CDN 要求 `Referer`，而 `downloads` API 既不能设置该请求头，DNR 的请求头改写也不作用于下载请求；由扩展页面 `fetch`（受 DNR 规则覆盖）取回 Blob 后再保存，可以稳定处理 HEVC 等受限 CDN。

### 为什么需要 `rules/media-referer.json`

部分 B 站 CDN（例如 `*.edge.mountaintoys.cn`）会校验 `Referer`。网页内播放器会自动带上，但扩展页面的 `fetch` 默认没有。`declarativeNetRequest` 规则为 `bilivideo.com`、`bilivideo.cn`、`mountaintoys.cn`、`akamaized.net`、`szbdyd.com` 的请求补充：

```text
Referer: https://www.bilibili.com/
```

规则只覆盖 `xmlhttprequest`（下载页 `fetch`）。`chrome.downloads` 直接请求 URL 时既不能携带 Referer，DNR 的请求头改写也不作用于这类下载请求，因此视频流统一由下载页 `fetch` 取回 Blob 后再保存，而不是把签名 URL 直接交给 `chrome.downloads`。

## 下载任务结构

```js
{
  id, createdAt, mode, title, bvid, page, duration, qualityLabel,
  filename,          // merge / audio
  filenames,         // separate
  video: { url, backups, codecs, width, height, estimatedSize } | null,
  audio: { url, backups, codecs, estimatedSize } | null,
  codec: 'avc' | 'hevc' | 'av1' | 'other'
}
```

任务存放在 `chrome.storage.session`，有效期 2 小时，不写入磁盘持久化；浏览器关闭后自动清空。

## 扩展新站点

建议把站点差异收敛到适配器，而不是复制面板：

```js
// 伪代码
const adapter = {
  id: 'douyin',
  matches(url) {},
  parse(url) {},                 // 返回站点内视频引用
  async getVideo(ref) {},        // 标题、封面、分 P、时长
  async listQualities(video) {}, // 可选清晰度
  async resolve(ref, quality, codec) {}, // 视频/音频流地址
  buildFilename(video, quality) {},
};
```

落地步骤：

1. 新建 `src/background/sites/douyin.js`，实现与 `bilibili.js` 类似的能力。
2. 在 `service-worker.js` 中按消息里的 `site` 字段路由到对应适配器。
3. 内容脚本的 URL 解析改为站点配置；面板本身可以复用。
4. 为站点域名增加 `host_permissions` 与必要的 Referer/UA 规则。
5. 为新站点补一套真实页面的回归测试。

面板组件目前仍与 B 站字段有少量耦合（`bvid`、分 P 文案），抽站点时优先把这些字段改为通用 `videoId` / `parts`。

## 安全与边界

- 不读取或导出 Cookie；Service Worker 的 `fetch` 使用浏览器现有登录态。
- 不调用非公开接口，不破解签名之外的访问控制。
- 不绕过会员、付费、地区限制或 DRM；接口返回无权限时直接向用户说明。
- 视频只在本地浏览器内存中处理，不经过自建服务器。
- 由于 ffmpeg.wasm 核心采用 GPL-2.0-or-later，当前项目整体按 GPL-2.0-or-later 发布。
