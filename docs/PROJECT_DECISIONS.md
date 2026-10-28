# 项目决策与发布日志

> 最后更新：2026-10-28  
> 目的：记录已经确认的产品/分发/技术决策，避免后续迭代反复讨论；同时记录 GitHub 发布环境和登录问题的解决办法。

---

## 一、当前状态

- 版本：`0.1.0`
- 状态：**已发布**，已在 Chrome 156 实测
- GitHub：<https://github.com/compassscout/bilibili-video-downloader>
- 在线安装页：<https://compassscout.github.io/bilibili-video-downloader/>
- Release：<https://github.com/compassscout/bilibili-video-downloader/releases/tag/v0.1.0>
- 发布提交：`main` 分支最新提交（2026-10-28）
- 已支持：
  - B 站普通视频（`/video/`）
  - 多 P
  - 清晰度选择
  - H.264 / HEVC / AV1
  - 合并 MP4
  - 分离视频/音频
  - 仅音频 M4A
  - 独立下载页、进度、失败重试
  - B 站 SPA 切换视频
  - CDN Referer 补充（DNR）
- 未支持：
  - 番剧、电影、电视剧
  - 直播、课程、互动视频复杂分支
  - FLV/durl 分段
  - 批量下载/队列
  - 4K/8K 的额外适配（API 支持，但受账号权限与 CDN 限制）

**当前原则：先保持 0.1.0 可用，不为“功能更多”破坏已有下载链路。**

---

## 二、已确认的产品边界

### 1. 只做“用户本来就能正常观看的公开视频”

不做：

- 会员/付费内容绕过；
- DRM 绕过；
- 地区限制绕过；
- “能看不能缓存”的版权受限内容宣传；
- 番剧/电影作为主卖点。

原因：竞品已收到 B 站律师函，公告称近期从各商店下架。详见 [竞品分析](COMPETITOR_ANALYSIS.md)。

### 2. 商店版使用中性品牌

- 仓库名可以用 `bilibili-video-downloader`；
- 商店展示名避免直接使用 B 站官方 Logo/商标做背书；
- 描述写“支持 B 站普通视频”，不要写“破解/去限制/付费也能下”；
- 免责声明和隐私政策必须存在。

### 3. 分发顺序

1. GitHub Release + GitHub Pages（已上线）；
2. 收集反馈、修复安装/合并问题；
3. 再尝试 Chrome Web Store / Edge Add-ons；
4. 商店是增量，不是唯一命脉，默认接受“可能下架”。

### 4. 商业化

- 短期：免费开源 + 赞赏/赞助；
- 中期：免费扩展 + 付费桌面端（批量、多站点、长视频、4K）；
- 长期：B2B / 白标 / 版权清晰场景；
- 不做扩展内广告；
- 不做“付费解锁 B 站受限内容”；
- 当前 GPL-2.0-or-later 不适合闭源付费扩展；若要走 Pro 扩展，先换掉 ffmpeg.wasm 或拆分桌面端。

---

## 三、竞品结论（摘要）

竞品：`bilibili哔哩哔哩下载助手 3.0.4`。

关键结论：

- 它的架构是“页面注入 + 页面上下文 fetch”，无后台、几乎无权限；
- 它覆盖番剧/电影/FLV，功能比我们广；
- 它靠 hook 播放器 `/playurl` 请求 + 用户在播放器切清晰度；
- 它靠赞赏码变现，没有明显广告/付费墙；
- 作者公告称收到 B 站律师函，近期下架；
- 我们不能照搬“版权受限内容”定位和远程 unpkg 加载。

完整对比见 [COMPETITOR_ANALYSIS.md](COMPETITOR_ANALYSIS.md)。

---

## 四、GitHub 发布环境与登录问题（重要）

### 问题现象

- 这台电脑的 GitHub 账号登录在 **Google Chrome**；
- 系统默认浏览器是 **Edge**；
- 运行 `gh auth login --web` 时，GitHub 授权页自动跳到 Edge，导致“Chrome 已登录、Edge 没登录”的割裂；
- 同时，命令行访问 `github.com` 可能超时，但 `api.github.com` 正常。

### 原因

1. `gh auth login --web` 使用系统默认浏览器，默认是 Edge。
2. Chrome 使用本地代理 `127.0.0.1:3067`；命令行默认不走该代理，所以 `github.com:443` 可能超时。
3. `gh` 默认想写 `%APPDATA%\GitHub CLI`，当前环境可能没有写权限，导致“认证成功但配置保存失败”。

### 解决办法

不使用 `gh auth login --web` 自动打开的 Edge，而是：

1. 运行 `gh auth login --web --clipboard`，拿到一次性设备码；
2. **显式用 Chrome 打开** `https://github.com/login/device`：

```powershell
Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' `
  -ArgumentList 'https://github.com/login/device'
```

3. 在 Chrome 中粘贴设备码，点击 Continue → Authorize GitHub CLI；
4. 给命令行设置 Chrome 使用的代理：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:3067'
$env:HTTP_PROXY  = 'http://127.0.0.1:3067'
```

5. 给 `gh` 指定可写配置目录：

```powershell
$env:GH_CONFIG_DIR = '<workspace>\_gh\config'
```

6. 如果 `gh` 仍无法保存凭证，可从 Windows 凭据管理器读取 `gh:github.com:compassscout` 的 token，设置 `GH_TOKEN` 后使用；**不要把 token 写进仓库或聊天记录**。

### 本机已验证可用的路径

- 便携版 `gh`：`<workspace>\_gh\bin\gh.exe`
- 环境脚本：`<workspace>\_gh\gh-env.ps1`
- 代理：`http://127.0.0.1:3067`
- GitHub 账号：`compassscout`
- token scopes：`repo`, `read:org`, `gist`

> `gh-env.ps1` 从 Windows 凭据管理器读取 token，不包含明文 token。  
> 每次新开终端可执行：
>
> ```powershell
> Set-ExecutionPolicy -Scope Process Bypass -Force
> . '<workspace>\_gh\gh-env.ps1'
> ```

### 以后如果又跳到 Edge

三种处理，按推荐顺序：

1. **不修改默认浏览器**：继续用上面的方式，显式打开 Chrome；
2. 临时把默认浏览器改成 Chrome，授权完再改回来；
3. 直接在 Chrome 的 GitHub 设置里创建 PAT，写入本地环境变量 `GH_TOKEN`（不要提交）。

---

## 五、发布 Runbook

### 1. 本地准备

```powershell
cd 'E:\创业新机会\开始尝试自己做软件插件\1.浏览器插件b站视频下载'
git init
git branch -M main
```

### 2. 创建仓库

```powershell
gh repo create compassscout/bilibili-video-downloader `
  --public `
  --description "B站公开视频下载扩展：多 P、清晰度选择、本地合并 MP4" `
  --source . `
  --remote origin `
  --push
```

### 3. 创建 Release

```powershell
gh release create v0.1.0 `
  '..\B站视频下载器-v0.1.0.zip' `
  --title 'v0.1.0' `
  --notes '首个公开版本：B站普通视频下载、多P、清晰度、合并MP4、分离/仅音频。'
```

### 4. 开启 GitHub Pages

```powershell
gh api --method POST repos/compassscout/bilibili-video-downloader/pages `
  -f 'source[branch]=main' `
  -f 'source[path]=/docs'
```

访问：

- `https://compassscout.github.io/bilibili-video-downloader/`
- `https://github.com/compassscout/bilibili-video-downloader/releases`

### 5. 发布后自检

- [ ] README 的安装步骤能走通；
- [ ] Release ZIP 能下载、解压、加载；
- [ ] Pages 首页能打开，截图正常；
- [ ] 下载页的 ZIP 链接指向最新 Release；
- [ ] 仓库没有 `_metadata/`、`*.zip`、token、临时文件；
- [ ] `LICENSE` 和 `THIRD_PARTY_NOTICES.md` 已包含。

---

## 六、后续迭代优先级

### P0：不破坏可用性

- 修复安装/解析/合并失败；
- 保持 B 站普通视频链路稳定；
- 兼容 B 站页面改版。

### P1：体验

- 下载页进度/错误提示继续优化；
- 失败后“兼容模式”直接保存分离轨道；
- 检查更新提示（只跳转 Release，不远程执行代码）；
- 更清晰的中文错误信息。

### P2：能力

- 免费内容的 FLV/durl 兜底（先评估合规）；
- 批量队列（优先桌面端，不急着塞扩展）；
- 多站点适配器（抖音/TikTok/小红书等，另起模块）；
- 4K/8K 的实际账号/编码适配测试。

### P3：商业化

- 赞赏入口；
- 付费桌面端需求验证；
- B2B/白标方案；
- 不做“付费解锁受限内容”。

---

## 七、相关文档

- [README](../README.md)
- [架构说明](ARCHITECTURE.md)
- [分发与变现](DISTRIBUTION_AND_MONETIZATION.md)
- [竞品分析](COMPETITOR_ANALYSIS.md)
- [第三方许可](../THIRD_PARTY_NOTICES.md)
