# B站视频下载器

一个 Chrome / Edge Manifest V3 扩展：在 B 站普通视频页右下角解析并下载公开视频，支持多 P、清晰度选择、音视频自动合并为 MP4，以及仅下载音频。

> 当前版本 `0.1.0`，只支持 `bilibili.com/video/` 下的普通视频。番剧、直播、课程、付费内容与 DRM 内容不在支持范围内。

[![Release](https://img.shields.io/github/v/release/compassscout/bilibili-video-downloader?color=fb7299&label=release)](https://github.com/compassscout/bilibili-video-downloader/releases)
[![License](https://img.shields.io/github/license/compassscout/bilibili-video-downloader?color=20a464)](https://github.com/compassscout/bilibili-video-downloader/blob/main/LICENSE)
[![Install](https://img.shields.io/badge/install-GitHub%20Pages-fb7299)](https://compassscout.github.io/bilibili-video-downloader/)

- 在线安装页：<https://compassscout.github.io/bilibili-video-downloader/>
- GitHub 仓库：<https://github.com/compassscout/bilibili-video-downloader>
- 最新 Release：<https://github.com/compassscout/bilibili-video-downloader/releases>

![下载面板](docs/panel.png)

## 功能

- **页面内下载面板**：无需复制链接，打开 B 站视频页即可使用。
- **多 P 视频**：识别分 P，切换后重新解析对应视频。
- **清晰度与编码**：展示当前账号可用的清晰度，可选择 H.264 / HEVC / AV1（以 B 站实际返回为准）。
- **本地合并**：分别下载视频轨和音频轨，在浏览器内用 ffmpeg.wasm 合并为完整 MP4，不重新编码，不上传文件。
- **多种保存方式**：合并 MP4、分别保存视频/音频、仅保存 M4A 音频。
- **账号权限内下载**：复用浏览器已有的 B 站登录状态，不导出 Cookie，不绕过会员、付费或 DRM 限制。
- **为后续站点预留结构**：当前 B 站逻辑集中在独立模块中，后续可增加抖音、TikTok、小红书、Instagram、X 等站点适配器。

## 安装

### Chrome

1. 打开 `chrome://extensions/`。
2. 右上角开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本项目根目录（包含 `manifest.json` 的那一层）。
5. 打开任意 `https://www.bilibili.com/video/...` 页面，右下角会出现「下载」按钮。

### Edge

1. 打开 `edge://extensions/`。
2. 开启「开发人员模式」。
3. 点击「加载解压缩的扩展」，选择本项目根目录。

> Chrome 137 起官方版不再支持通过命令行 `--load-extension` 加载本地扩展，请使用扩展管理页面的「加载已解压」方式。更新代码后，在扩展管理页点击刷新，并刷新 B 站页面。

## 使用

1. 打开 B 站视频页，点击右下角「下载」。
2. 选择分 P（如有）、清晰度和视频编码。
3. 保持「合并为完整 MP4」开启，点击「下载并合并 MP4」。
4. 扩展会打开一个本地下载页，依次下载视频轨、音频轨、合并并保存。首次合并需要加载约 32 MB 的本地引擎，之后会快很多。
5. 选择「分别下载」或「仅下载音频」时也会打开同一个下载页，只是跳过合并、直接保存轨道文件。
6. 如果合并失败，可在下载页点击「分别下载视频 / 音频」，再用剪辑软件或本地 ffmpeg 合并。

也可以点击浏览器工具栏中的扩展图标，从弹窗打开当前页面的下载面板。

## 画质说明

扩展调用 B 站网页播放接口，能下载到的清晰度取决于：

- 是否登录 B 站；
- 账号是否有该视频的大会员/版权权限；
- 视频本身提供的清晰度与编码。

未登录时通常只能看到 360P / 480P；登录后可获取账号允许的更高清晰度。扩展不会伪造权限，也不会绕过付费或 DRM。

## 常见问题

**看不到「下载」按钮？**

- 确认页面地址是 `https://www.bilibili.com/video/...`；
- 在扩展管理页确认扩展已启用；
- 安装或更新扩展后刷新 B 站页面；
- B 站是单页应用，切换视频后按钮会自动更新；如果异常，刷新一次页面。

**解析失败 / 提示风控？**

先确认已登录 B 站并刷新视频页。若仍失败，可能是 B 站接口调整、视频地区限制或临时风控。扩展只使用普通网页播放接口，遇到 `-10403` 等错误时不会尝试绕过。

**合并很慢或失败？**

- 合并引擎在本地运行，首次加载约 32 MB；
- 4K、长视频会占用较多内存，建议先关闭其他占用内存的标签页；
- 失败时可选择「分别下载」，或改用 H.264 编码重试；
- 极长视频（例如数小时）可能超出浏览器内存，建议使用桌面下载工具。

**下载的 MP4 没有声音？**

请确认使用的是「下载并合并 MP4」，而不是「分别下载」。如果合并页报错，选择分别下载后可用本地 ffmpeg 合并：

```bash
ffmpeg -i video.mp4 -i audio.m4a -c copy output.mp4
```

**HEVC / AV1 下载失败？**

部分 CDN 对编码和 Referer 有额外限制。扩展已通过声明式规则为 B 站 CDN 补充 Referer；若仍失败，请切换到 H.264（兼容性最好）后重试。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存合并开关、编码偏好和短期下载任务 |
| `downloads` | 将合并后的 MP4 或分离轨道保存到浏览器下载目录 |
| `activeTab` | 从工具栏弹窗与当前 B 站页面通信 |
| `host_permissions` | 访问 B 站 API、视频 CDN 与封面域名 |
| `declarativeNetRequestWithHostAccess` | 为部分需要 Referer 的 B 站 CDN 请求补充 `https://www.bilibili.com/` |

扩展没有自建服务器，不上传视频、账号信息或浏览记录，也没有统计脚本。

## 项目结构

```text
.
├─ manifest.json
├─ rules/
│  └─ media-referer.json       # 为 B 站 CDN 补充 Referer
├─ src/
│  ├─ background/
│  │  ├─ service-worker.js     # 消息路由、下载任务、文件命名
│  │  └─ bilibili.js           # B 站 API、WBI 签名、清晰度/编码选择
│  ├─ content/
│  │  └─ content.js            # 页面内浮动按钮与下载面板
│  ├─ downloader/
│  │  ├─ downloader.html       # 本地合并下载页
│  │  ├─ downloader.css
│  │  └─ downloader.js         # 下载轨道、ffmpeg.wasm 合并、保存
│  ├─ popup/                   # 工具栏弹窗
│  ├─ shared/
│  │  └─ md5.js                # WBI 签名所需 MD5
│  └─ vendor/ffmpeg/           # 自托管 ffmpeg.wasm 运行时
├─ docs/
│  ├─ index.html               # GitHub Pages 安装页
│  ├─ panel.png
│  ├─ downloader.png
│  ├─ ARCHITECTURE.md
│  ├─ DISTRIBUTION_AND_MONETIZATION.md
│  ├─ COMPETITOR_ANALYSIS.md
│  └─ PROJECT_DECISIONS.md
├─ THIRD_PARTY_NOTICES.md
└─ LICENSE
```

## 开发

项目使用原生 JavaScript（ES Modules + 内容脚本），**无需构建**，修改后重新加载扩展即可。

主要流程：

1. 内容脚本从 URL 解析 `bvid` / `av` 号和 `p`。
2. Service Worker 请求 `view` 接口获取标题、分 P 与 `cid`。
3. 使用 WBI 签名请求 `playurl` 获取 DASH 视频/音频流。
4. 合并模式把任务写入 `chrome.storage.session`，打开 `downloader.html`。
5. 下载页拉取媒体流，用 ffmpeg.wasm 执行 `-c copy` 封装为 MP4，再通过 `chrome.downloads` 保存。

更完整的模块说明、扩展新站点的思路和数据流见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 分发与商业化

关于 GitHub / Chrome 商店 / Edge 商店 / 油猴脚本 / 变现路线的讨论，见 [docs/DISTRIBUTION_AND_MONETIZATION.md](docs/DISTRIBUTION_AND_MONETIZATION.md)。

竞品分析与已确认的产品边界见：

- [docs/COMPETITOR_ANALYSIS.md](docs/COMPETITOR_ANALYSIS.md)
- [docs/PROJECT_DECISIONS.md](docs/PROJECT_DECISIONS.md)

## 已知限制

- 只支持 B 站普通视频页，不含番剧、直播、课程、互动视频的复杂分支。
- 没有批量下载、断点续传和下载队列（后续版本再考虑）。
- 合并在浏览器内存中完成，超大文件可能失败。
- 依赖 B 站网页接口；接口或风控策略变化时可能需要更新。
- 不支持也不应尝试绕过付费、会员、DRM 或版权保护。

## 合规与许可

请只下载你有权保存的内容，仅用于个人学习与备份，遵守 B 站用户协议、社区规则和 UP 主授权。请勿将下载内容用于二次传播、商业使用或规避平台限制。

本项目以 **GPL-2.0-or-later** 发布，因为内置的 `@ffmpeg/core` 采用 GPL-2.0-or-later。若你计划闭源分发，需要替换为许可兼容的合并方案，或改为依赖用户本机安装的 FFmpeg。第三方组件说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
