# 分发、安装与变现笔记

> 记录时间：2026-10-28  
> 当前项目：`1.浏览器插件b站视频下载`  
> 当前版本：Manifest V3，Chrome 156 实测通过；内置 ffmpeg.wasm，支持合并、分离和仅音频下载。

---

## 一、先给结论

### 1. 能不能让用户自己装到浏览器？

**可以，但“从 GitHub 下载后双击安装”在 Chrome 稳定版上不可行。**

可行方式是：

1. 用户从 GitHub Releases 下载 ZIP；
2. 解压；
3. 打开 `chrome://extensions/`；
4. 开启「开发者模式」；
5. 点击「加载已解压的扩展程序」，选择解压后的目录。

这适合程序员、数码爱好者和早期种子用户，但对普通用户转化率不高，而且 Chrome 可能提示“开发者模式扩展”。

真正的一键安装需要上架 **Chrome Web Store**（Edge 则是 **Edge Add-ons**）。GitHub 适合做源码托管、Release 下载和项目主页，不适合做 Chrome 的“应用商店”。

### 2. 能不能托管到 GitHub？

**可以，而且建议这样做。**

- GitHub 仓库：放源码、README、截图、LICENSE；
- GitHub Releases：放打包好的 ZIP（当前约 10.7 MB）；
- GitHub Pages：做一个下载落地页和安装教程；
- GitHub Issues：收集 bug 和功能请求。

但不要指望 GitHub 能提供 Chrome 商店那种一键安装体验。

### 3. 能不能上传到油猴（Tampermonkey）？

**不能直接上传这个扩展。油猴装的是用户脚本（userscript），不是浏览器扩展。**

要做油猴版本，需要重写成 `.user.js`，并且会损失：

- `chrome.downloads`、`chrome.storage.session`；
- MV3 Service Worker；
- `declarativeNetRequest` 请求头改写；
- 本地 ffmpeg.wasm 合并的稳定性；
- 扩展的商店分发和自动更新。

油猴版可以做一个“轻量版”：解析 B 站视频、下载视频/音频直链或分离轨道。完整 MP4 合并建议保留在扩展/桌面端。

### 4. 怎么变现？

当前代码是 **GPL-2.0-or-later**（因为内置 `@ffmpeg/core`），这会影响闭源付费。  
比较现实的路线是：

- **短期**：开源免费 + 捐赠/赞助；
- **中期**：免费扩展引流，付费桌面端做批量、4K/8K、多站点、长视频；
- **长期**：B2B 定制、白标、技术支持；
- **不建议**：靠扩展内广告或单纯卖扩展 license，收益低、体验差、还容易被绕过。

---

## 二、安装与分发方案对比

| 方案 | 用户操作 | 是否一键 | 适合人群 | 主要问题 |
| --- | --- | --- | --- | --- |
| GitHub ZIP + 加载已解压 | 下载、解压、开开发者模式、选目录 | 否 | 技术用户、早期测试 | 步骤多；Chrome 提示开发者扩展 |
| Chrome Web Store | 点“添加至 Chrome” | 是 | 大众用户 | 审核、版权投诉、下架风险；$5 开发者注册费 |
| Edge Add-ons | 点“获取” | 是 | Edge 用户 | 单独上架、单独审核 |
| 自托管 `.crx` | 下载后拖入/打开 | 名义上可以，实际很不稳定 | 企业/高级用户 | Chrome 稳定版通常阻止非商店 CRX |
| 企业策略安装 | 管理员配置 | 是（企业内） | 公司/学校 | 需要管理员权限，不适合消费者 |
| 油猴脚本 | 安装 `.user.js` | 是（脚本级） | 油猴用户 | 不是扩展，功能受限 |
| 桌面端 + 浏览器扩展 | 安装桌面程序 | 是 | 重度用户/付费用户 | 开发成本、签名、跨平台 |

### 关键事实

- **Chrome 稳定版不会随便安装第三方 `.crx`**。  
  即使把 `.crx` 放在 GitHub，普通用户下载后拖进扩展页，也可能被拒绝或随后禁用。不要把它作为主分发方式。
- **GitHub 上的 ZIP 只能“加载已解压”**。  
  这是 Chrome 官方支持的开发者加载方式，但不是面向大众的安装方式。
- **Chrome 137 起官方版移除了命令行 `--load-extension`**。  
  所以不能靠一个 `.bat` 脚本帮用户自动加载扩展；这类脚本在新版 Chrome 上不可靠。
- **上架商店后，更新由商店负责**；GitHub 解压版不会自动更新，除非自己加“检查更新”提示（只能提示，不能静默替换代码）。

---

## 三、GitHub 具体怎么落地

### 推荐仓库结构

```text
bilibili-downloader/
├─ README.md                 # 项目介绍、截图、安装、FAQ
├─ LICENSE                   # GPL-2.0
├─ manifest.json
├─ src/
├─ rules/
├─ icons/
├─ docs/
│  ├─ panel.png
│  ├─ downloader.png
│  └─ ARCHITECTURE.md
└─ .github/
   └─ workflows/
      └─ release.yml         # 可选：打 ZIP 并创建 Release
```

### 推荐发布流程

1. 建公开 GitHub 仓库，推送源码。
2. 打 tag，例如 `v0.1.0`。
3. 在 GitHub Releases 上传 `B站视频下载器-v0.1.0.zip`。
4. 用 GitHub Pages 做一个简单落地页：
   - 功能介绍；
   - 截图；
   - `Download ZIP` 按钮；
   - Chrome / Edge 安装步骤；
   - 常见问题；
   - 隐私说明与免责声明。
5. README 顶部放 Release 徽章和下载链接。

### 注意事项

- 仓库里的 `ffmpeg-core.wasm` 约 32 MB，低于 GitHub 单文件 100 MB 限制，可以直接提交；如果以后更大，再考虑 Git LFS。
- Release ZIP 目前约 10.7 MB，适合直接下载。
- 公开仓库意味着别人可以 fork。当前 GPL 许可下这本来就是允许的；如果介意，先想清楚商业模式，而不是靠“藏代码”。
- 不要让扩展从远程加载可执行代码（Chrome Web Store 明确禁止 remote code）。当前 ffmpeg 是本地打包，符合要求。
- 如果加“检查更新”，只打开 GitHub Releases 页面或提示新版本，不要静默下载并执行远程脚本。

---

## 四、上架 Chrome Web Store / Edge Add-ons

### 基本流程

1. 注册 Chrome Web Store 开发者账号（一次性 $5，按当期政策为准）。
2. 准备商店素材：
   - 128×128 图标；
   - 至少 1 张截图（1280×800 或 640×400）；
   - 简短描述、详细描述；
   - 隐私政策页面（即使不收集数据，也建议有）。
3. 上传 ZIP。
4. 填写权限用途说明：
   - `downloads`：保存用户主动下载的文件；
   - `storage`：保存设置和短期任务；
   - `host_permissions`：访问 B 站 API 和视频 CDN；
   - `declarativeNetRequestWithHostAccess`：为部分 CDN 补充 Referer；
   - `activeTab`：从弹窗与当前页通信。
5. 提交审核。

### 可能的审核风险

- **版权/下载器类目**：商店对“下载视频”类扩展通常更谨慎，可能被要求说明不绕过 DRM、不下载付费内容；也可能因投诉下架。
- **商标**：名称、图标、描述中大量使用“B站/哔哩哔哩”可能涉及商标问题。商店版建议用更中性的名字，例如“视频下载助手”，描述里写“支持 B 站普通视频”。
- **权限**：`host_permissions` 越宽，审核越可能追问。当前已尽量限制在 B 站和已知 CDN；不要为了省事改成 `<all_urls>`。
- **单一用途**：扩展应围绕“下载当前视频”一个目的；不要塞入无关功能。
- **隐私**：当前不上传数据，这是优势；在隐私政策中明确写“视频只在本机处理”。

### 建议策略

1. **先 GitHub 发布**，验证真实用户和 bug。
2. **再尝试 Chrome Web Store**；即使被拒，也有 GitHub 渠道。
3. **Edge Add-ons 同步上架**，审核通常独立。
4. 商店版和 GitHub 版可以共用代码，但商店版要更注意品牌、权限和描述合规。

---

## 五、油猴（Tampermonkey）到底能不能做

### 结论

**当前扩展不能直接“上传到油猴”。**  
Tampermonkey 是一个用户脚本管理器，不是 Chrome 扩展商店；它运行的是 `.user.js` 脚本，不是 MV3 扩展包。

### 扩展 vs 油猴脚本

| 能力 | 当前扩展 | 油猴脚本 |
| --- | --- | --- |
| 页面内 UI | 可以（Shadow DOM） | 可以（Shadow DOM / GM_addStyle） |
| 调用 B 站 API | Service Worker + Cookie | 页面上下文 fetch，通常自带 Cookie/Referer |
| 下载文件 | `chrome.downloads` | `GM_download` 或 Blob + `<a download>` |
| 跨域请求 | host_permissions | `GM_xmlhttpRequest`（需 `@connect`） |
| 设置存储 | `chrome.storage` | `GM_setValue/GM_getValue` |
| 请求头改写 | DNR | 页面 fetch 自带 Referer；或 GM_xmlhttpRequest 自定义 |
| ffmpeg.wasm 合并 | 扩展页本地运行 | 受页面 CSP、Worker、内存限制，不推荐 |
| 自动更新 | 商店/手动 | `@updateURL` / `@downloadURL` |
| 分发 | Chrome/Edge 商店、GitHub | Greasy Fork、GitHub raw、OpenUserJS |

### 油猴版能做什么

可行：

- 解析当前 B 站视频的标题、CID、清晰度；
- 获取 DASH 视频/音频地址；
- 用 `GM_download` 下载视频轨和音频轨；
- 提供“复制直链”“下载封面”“下载字幕”等轻功能；
- 可选：用轻量 MP4 封装库在页面内合并（工程量大，且受 CSP/内存限制）。

不推荐：

- 在油猴里跑 32 MB ffmpeg.wasm；
- 做 4K/长视频合并；
- 依赖 `chrome.downloads` 的下载管理；
- 依赖 DNR 请求头改写。

### 发布到油猴的路径

1. 写一个 `.user.js`，头部包含：

```js
// ==UserScript==
// @name         B站视频辅助下载
// @namespace    https://github.com/yourname/bilibili-downloader
// @version      0.1.0
// @description  解析并下载 B 站普通视频的公开音视频流
// @match        https://www.bilibili.com/video/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      bilivideo.com
// @connect      bilivideo.cn
// @connect      mountaintoys.cn
// @downloadURL  https://raw.githubusercontent.com/.../bilibili.user.js
// @updateURL    https://raw.githubusercontent.com/.../bilibili.user.js
// ==/UserScript==
```

2. 托管方式：
   - **GitHub raw**：用户点击 `.user.js` 链接，Tampermonkey 会弹出安装页；
   - **Greasy Fork**：上传脚本，获得页面和自动更新；
   - **OpenUserJS**：另一个脚本站。
3. 注意：
   - Greasy Fork 通常要求代码可读，不允许混淆；
   - 下载器类脚本可能因版权投诉被下架；
   - 油猴脚本代码对用户可见，付费/授权很难做强控制；
   - 不建议把“付费解锁”放在纯前端脚本里。

### 建议

油猴版不要做成当前扩展的“移植版”，而是做成 **轻量引流版**：

- 免费：解析、复制直链、分离下载；
- 引导：需要一键合并 MP4/批量/4K，使用扩展或桌面端；
- 这样既能获得油猴流量，又不会维护两套复杂合并逻辑。

---

## 六、变现方案

### 先看清许可证

当前项目内置 `@ffmpeg/core`，其许可证是 **GPL-2.0-or-later**。这意味着：

- 你可以卖钱，但如果分发软件，需要按 GPL 提供对应源代码；
- 用户拿到的版本可以继续复制、修改、再分发；
- 想做一个“闭源付费扩展”，当前架构不合适。

三条路：

1. **接受 GPL**：开源免费 + 捐赠/赞助/商业支持；
2. **换掉 ffmpeg.wasm**：用 MIT/BSD 的 MP4 封装库（如 mp4box.js + mp4-muxer）或自研 muxer，然后改成 MIT/Apache/商业许可；
3. **拆成两层**：扩展保持开源免费；付费桌面端用独立进程调用本机 FFmpeg（需律师确认许可与分发方式）。

### 方案 A：捐赠/赞助（最快）

适合早期：

- GitHub Sponsors；
- 爱发电；
- Ko-fi / Buy Me a Coffee；
- 微信/支付宝收款码（放在落地页，注意合规）。

优点：不改代码、不建后端、不破坏开源。  
缺点：收入不稳定，国内用户付费意愿有限。

### 方案 B：免费扩展 + 付费桌面端（最推荐）

扩展负责“轻量、免费、获客”：

- 单视频；
- 普通清晰度；
- 合并 MP4；
- 基础多 P。

桌面端负责“重度、付费”：

- 批量下载/队列；
- 4K/8K/HDR；
- 多站点（抖音/TikTok/小红书/Instagram/X）；
- 断点续传、代理、字幕、封面、元数据；
- 长视频稳定合并；
- 自动命名/归档。

定价参考：

- 桌面端终身版：¥99–199；
- 年费：¥39–69/年；
- 早期支持者：¥49–99 终身早鸟。

优点：付费点清晰，扩展开源不影响获客。  
缺点：桌面端开发、签名、跨平台、更新成本高。

### 方案 C：Pro 扩展（需要换许可证）

如果坚持只做扩展：

- 免费版：720P/单视频/手动；
- Pro：1080P+、批量、字幕、封面、队列、多站点；
- 用 license key 或离线签名授权。

但要注意：

- GPL 代码下做闭源 Pro 不可行；
- 纯前端 license 容易被绕过；
- 需要后端/支付/客服；
- 用户对“下载器付费”的价格敏感。

### 方案 D：B2B / 白标 / 定制

面向企业、媒体、教育、电商：

- 内部素材归档工具；
- 定制站点适配；
- 私有部署/桌面工具；
- 技术支持与维护合同。

定价：¥2,000–20,000/项目，或年度维护。  
优点：客单价高，不依赖海量用户。  
缺点：需要销售、合同、发票、售后。

### 方案 E：广告（不推荐）

- 扩展内广告影响体验；
- 商店审核和隐私政策更复杂；
- 下载器用户对广告反感；
- 收入通常很低，不值得。

### 支付渠道

- 国内：爱发电、微信/支付宝、知识星球（视形式）；
- 海外：Paddle、Lemon Squeezy、Gumroad（作为 Merchant of Record 处理税务）；
- 订阅/授权：需要后端或离线 license 文件。

### 现实建议

先做 **GitHub 开源 + 捐赠**，验证下载量和留存；  
如果用户明确要求批量/4K/多站点，再做 **付费桌面端**；  
不要一开始就花几个月做 license 后端。

---

## 七、风险与合规

1. **版权**：只能下载用户有权保存的内容；不要宣传“破解/去限制/付费也能下”。
2. **平台条款**：B 站可能限制下载；扩展可能因接口变化失效，也可能收到投诉。
3. **商标**：商店版避免直接使用 B 站官方 Logo/名称作为品牌；描述中做“兼容/支持”说明。
4. **DRM**：绝不绕过 DRM、付费、会员、地区限制；当前实现只使用普通网页播放接口。
5. **隐私**：当前不上传视频和账号信息；如果以后加统计/登录/支付，需要更新隐私政策。
6. **GPL**：分发前确认源码可获取；不要删除 LICENSE/NOTICE。
7. **Chrome 政策**：禁止远程代码、欺骗性安装、权限滥用；当前本地 ffmpeg 符合，但商店审核仍可能追问下载器类目。
8. **供应链**：ffmpeg.wasm 文件要锁定版本和哈希（已在 `THIRD_PARTY_NOTICES.md` 记录）。

---

## 八、建议的推进顺序

### 第 1 阶段：GitHub 可安装版

- [ ] 建公开仓库；
- [ ] 上传源码和 Release ZIP；
- [ ] GitHub Pages 落地页；
- [ ] README 写清“加载已解压”步骤；
- [ ] 收集 20–50 个真实用户反馈；
- [ ] 修复安装失败、清晰度、合并失败等高频问题。

### 第 2 阶段：商店上架

- [ ] 准备隐私政策、截图、描述；
- [ ] 改用更中性的商店名称/图标；
- [ ] 提交 Chrome Web Store；
- [ ] 同步 Edge Add-ons；
- [ ] 根据审核意见调整权限和文案。

### 第 3 阶段：轻量油猴版

- [ ] 只做解析 + 分离下载；
- [ ] 发布到 Greasy Fork / GitHub raw；
- [ ] 在脚本里引导“需要合并 MP4 可安装扩展”；
- [ ] 不投入 ffmpeg.wasm 合并。

### 第 4 阶段：变现

- [ ] 先开捐赠；
- [ ] 观察用户是否愿意为批量/4K/多站点付费；
- [ ] 再决定做桌面端还是换许可证做 Pro 扩展；
- [ ] 不要在没有需求验证前做复杂支付/授权系统。

---

## 九、我们这次聊天的关键信息（归档）

### 产品

- 浏览器扩展，最初用于 B 站视频下载；
- 后续可能扩展到抖音、TikTok、小红书、Instagram、X；
- 当前只做 B 站普通视频；
- 支持多 P、清晰度、H.264/HEVC/AV1、合并 MP4、分离、仅音频；
- 本地 ffmpeg.wasm 合并，不上传文件；
- 不绕过会员/付费/DRM。

### 技术

- Manifest V3；
- 内容脚本 + Shadow DOM 面板；
- Service Worker 处理 B 站 API、WBI 签名、任务；
- 下载页负责拉流、合并、保存；
- DNR 为部分 CDN 补充 Referer；
- `chrome.storage.session` 保存短期任务；
- 使用 `chrome.downloads` 保存 Blob；
- Chrome 156 实测：AVC/HEVC/AV1 合并、HEVC 分离、仅音频、多 P、SPA 切换、弹窗均通过；
- 合并结果用 `moov` 检查，避免保存半成品。

### 分发

- GitHub 可托管源码/Release/Pages；
- GitHub ZIP 只能“加载已解压”，不是一键安装；
- 一键安装需要 Chrome Web Store / Edge Add-ons；
- 第三方 `.crx` 在 Chrome 稳定版不可靠；
- 油猴不能直接装扩展，需要重写 userscript。

### 变现

- 当前 GPL 许可证限制闭源付费；
- 推荐免费开源 + 捐赠，或免费扩展 + 付费桌面端；
- 纯前端 license 易被绕过；
- B2B/白标客单价更高；
- 广告不推荐。

### 待决策

1. 先上 GitHub 还是直接冲 Chrome 商店？
2. 是否接受 GPL，还是换掉 ffmpeg.wasm 以便闭源？
3. 主产品是扩展，还是“扩展 + 桌面端”？
4. 是否值得做油猴轻量版，还是把精力放在商店和桌面端？
5. 商店版是否改名为更中性的品牌，避免 B 站商标风险？
