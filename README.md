# Bilibili Downloader

哔哩哔哩视频一键下载 Chrome/Edge 浏览器扩展。

## 功能特性

- **一键下载** — 在 B站视频页面点击按钮即可下载
- **画质选择** — 自动获取所有可用画质（360P ~ 8K，取决于账号等级和视频支持）
- **分P支持** — 多P视频可自由切换选择下载
- **双入口操作** — 页面内按钮 + 浏览器工具栏弹出窗口
- **SPA 适配** — 支持 B站单页应用导航，切换视频自动刷新

## 安装方法

### 从源码安装（推荐）

1. 下载或克隆本仓库
   ```bash
   git clone https://github.com/xjwm5685-ui/bilibili-downloader.git
   ```
2. 打开 Chrome/Edge 浏览器，访问 `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择下载的 `bilibili-downloader` 文件夹

### 注意事项

- 需要 **登录 B站账号** 才能获取 1080P 及以上画质
- 未登录状态最高支持 480P/720P（取决于视频）

## 使用方式

### 方式一：页面内按钮

1. 打开任意 B站视频页面（`bilibili.com/video/BV...`）
2. 页面右上角出现蓝色 **下载** 按钮
3. 点击按钮，弹出画质选择面板
4. 选择画质和分P（多P视频），点击 **开始下载**

### 方式二：浏览器弹出窗口

1. 点击浏览器工具栏的扩展图标
2. 弹出窗口显示视频封面、标题、UP主、播放量等信息
3. 选择画质和分P，点击 **下载视频**

## 项目结构

```
bilibili-downloader/
├── manifest.json              # Manifest V3 配置
├── rules.json                 # declarativeNetRequest 规则（Referer 注入）
├── .gitignore
├── icons/                     # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   └── service-worker.js      # 后台服务：API 调用、下载管理
├── content/
│   ├── content.js             # 内容脚本：页面注入按钮、画质面板
│   └── content.css            # 注入元素样式
└── popup/
    ├── popup.html             # 弹出窗口 HTML
    ├── popup.css              # 弹出窗口样式
    └── popup.js               # 弹出窗口逻辑
```

## 技术实现

### 数据获取

- 从 B站页面内嵌的 `window.__INITIAL_STATE__` 和 `window.__playinfo__` 读取视频元数据和可用画质
- 通过 `chrome.scripting.executeScript` 在页面 MAIN world 中调用 B站 API 获取指定画质的流地址
- 利用页面上下文的 cookies 实现认证，无需额外权限

### 下载机制

- Service Worker 中使用 `fetch()` 配合 `Referer` 头请求 CDN 视频流
- 通过 Blob → Data URL 转换，使用 `chrome.downloads.download()` 触发浏览器原生下载
- 支持所有 B站 CDN 域名（`*.bilivideo.com`、`*.hdslb.com`）

### 画质对照

| qn 值 | 画质 |
|-------|------|
| 127 | 8K |
| 126 | 杜比视界 |
| 125 | HDR |
| 120 | 4K |
| 116 | 1080P 60帧 |
| 112 | 1080P+ |
| 80 | 1080P |
| 64 | 720P |
| 32 | 480P |
| 16 | 360P |

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 访问当前标签页信息 |
| `tabs` | 查询标签页 URL |
| `downloads` | 触发浏览器下载 |
| `scripting` | 在页面 MAIN world 中执行脚本 |
| `declarativeNetRequest` | 注入 Referer 头到 CDN 请求 |

## 常见问题

**Q: 下载的文件是 HTML 而不是视频？**
A: 确认已登录 B站，刷新页面后重试。

**Q: 没有 1080P 选项？**
A: 1080P 需要 B站登录状态，部分视频需要大会员。

**Q: 大文件下载很慢？**
A: 大文件（>200MB）需要先完整下载再转换格式，转换过程有进度提示，请耐心等待。

**Q: 支持哪些浏览器？**
A: Chrome 88+、Edge 88+ 及其他 Chromium 内核浏览器。

## 免责声明

本扩展仅供学习交流使用。请遵守哔哩哔哩用户协议，尊重创作者版权。下载内容仅供个人观看，请勿用于商业用途或二次分发。

## License

MIT
