# Audio Recorder

Audio Recorder 是一个 Chrome Manifest V3 本地录音扩展。它在用户主动点击录音按钮后请求麦克风权限，在本地生成 WebM 录音和 MP3 文件，并通过浏览器下载到本机。

## 功能说明

- 用户点击扩展图标后打开录音页面。
- 用户主动点击录音按钮后开始采集麦克风音频。
- 支持停止后预览 WebM 录音。
- 支持下载 WebM。
- 支持使用 `@breezystack/lamejs` 在本地编码并下载 MP3。
- 支持比特率选择、文件命名规则、时间码复制和自动下载 MP3 开关。
- 支持打开 `links.txt` 或文本框中保存的云端链接；当前代码不会上传录音。

## 项目结构

```text
.
├── .github/workflows/release.yml
├── icons/
├── scripts/validate-release.ps1
├── shared/
├── AudioRecorder.html
├── AudioRecorder.js
├── AudioRecorderWorklet.js
├── background.js
├── lamejs.iife.js
├── LICENSE-lamejs.iife.js.txt
├── manifest.json
├── PRIVACY.md
├── CHANGELOG.md
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

## 入口文件

- `manifest.json`: Chrome 扩展清单，Manifest V3。
- `background.js`: 扩展图标点击后打开 `AudioRecorder.html`。
- `AudioRecorder.html`: 录音页面 UI。
- `AudioRecorder.js`: 录音、计时、文件命名、下载和本地设置逻辑。
- `AudioRecorderWorklet.js`: AudioWorklet 音频采样处理。
- `lamejs.iife.js`: 第三方 MP3 编码库。

## 权限说明

当前 `manifest.json` 只声明：

- `downloads`: 用于 `AudioRecorder.js` 中的 `chrome.downloads.showDefaultFolder()`，在下载完成后由用户确认是否打开默认下载文件夹。

未声明 `host_permissions`。扩展不需要跨站读取页面内容，不需要任意网站访问权限。

麦克风访问由 `navigator.mediaDevices.getUserMedia({ audio: true })` 在用户点击录音按钮后触发，浏览器会显示权限提示。

## 构建方式

当前项目不需要 npm、Webpack、Vite 或其他构建步骤。源码即扩展运行文件。

本地检查：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/validate-release.ps1 -ExpectedVersion 1.23
```

加载到 Chrome：

1. 打开 `chrome://extensions/`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库根目录。

## Release

Release 由 GitHub Actions 在推送 `v*` 标签时自动生成。

```powershell
git tag v1.23
git push origin v1.23
```

工作流会检查 `manifest.json` 的 `version` 是否等于标签去掉 `v` 后的值，生成 ZIP，并创建 GitHub Release 与 build provenance attestation。

## 测试方法

- 运行 `scripts/validate-release.ps1`。
- 在 Chrome 中加载未打包扩展。
- 点击扩展图标，确认打开录音页面。
- 点击录音按钮，确认浏览器请求麦克风权限。
- 停止录音后确认可播放预览。
- 点击下载 WebM 和下载 MP3，确认文件能保存。
- 确认自动下载 MP3 开关行为符合预期。

## 注意事项

- 当前代码没有 Google Drive API 上传逻辑，也没有 OAuth Client Secret。
- `links.txt` 仅用于保存用户可手动打开的链接。
- 不要把真实录音、个人链接、令牌、私钥或 `.env` 文件提交到仓库。
- `lamejs.iife.js` 是第三方压缩 IIFE 文件，来源和许可证见 `THIRD_PARTY_NOTICES.md`。

