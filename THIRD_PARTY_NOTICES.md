# Third-Party Notices

本项目内置了 [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) 的浏览器运行时，用于在本地把 B 站 DASH 视频轨和音频轨封装为 MP4。

## @ffmpeg/ffmpeg 0.12.15

- 文件：`src/vendor/ffmpeg/ffmpeg.js`、`src/vendor/ffmpeg/814.ffmpeg.js`
- 许可证：MIT
- 项目：https://github.com/ffmpegwasm/ffmpeg.wasm
- SHA-256：
  - `ffmpeg.js`: `ad4cfe957589995dea03fc8de1fd5e9f5cb4558a7282913172203082a65bbfaa`
  - `814.ffmpeg.js`: `976f4174ae7da80c0d4f9523ee6dde3ecbce7dc2ee392b2a5322049abb9b8627`

## @ffmpeg/core 0.12.10

- 文件：`src/vendor/ffmpeg/ffmpeg-core.js`、`src/vendor/ffmpeg/ffmpeg-core.wasm`
- 许可证：GPL-2.0-or-later
- 项目：https://github.com/ffmpegwasm/ffmpeg.wasm
- FFmpeg 项目：https://ffmpeg.org/
- SHA-256：
  - `ffmpeg-core.js`: `b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21`
  - `ffmpeg-core.wasm`: `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`

该 WASM 核心由 ffmpeg.wasm 项目构建，包含 FFmpeg 代码。由于 `@ffmpeg/core` 使用 GPL-2.0-or-later，本项目整体按 GPL-2.0-or-later 发布，完整许可证见根目录 `LICENSE`。

如果需要闭源分发，请：

1. 使用自行构建的 LGPL 版 FFmpeg WASM 核心（需确认构建配置与许可证义务）；或
2. 移除内置合并引擎，改为调用用户本机安装的 FFmpeg；或
3. 采用许可兼容的 MP4 封装库替换。

## 图标与界面

扩展图标、页面 UI 为项目自有资产，无第三方图标库依赖。B 站名称与相关商标归上海幻电信息科技有限公司所有，本项目与 B 站官方无关联。
