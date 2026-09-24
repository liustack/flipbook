# 安全策略

## 报告漏洞

请私下报告，不要开公开 issue。

走 [GitHub Security Advisories](https://github.com/liustack/flipbook/security/advisories/new) 提交私密报告，修复发布前细节只在你和维护者之间。

附上确切命令、完整输出、`flipbook --version` 和 Node 版本，和 bug 报告要的信息一样。我们会确认收到、修复，并在你同意时致谢。

## 支持的版本

只修 npm 上最新发布的版本（`@liustack/flipbook`），报告前请先升级。

## 安全模型要点

- 合成文件是会在 Chromium 里执行的代码，可能来自模型，也可能来自网上。flipbook 用假源 `http://flipbook.local/` 提供文件，路径先解析成真实路径（跟随软链）再确认仍在合成目录内，越界请求一律拒绝。
- 渲染期间页面发出的 HTTP 请求（fetch、XHR、图片、字体、样式等）和 WebSocket 都在 Playwright 这一层拦下，不建连接，并以 `external-request` 记进报告。
- WebRTC 和 WebTransport 的构造函数在页面里被换成直接报错，调用也记成 `external-request`。浏览器启动时另外关掉 WebRTC 走 UDP 和浏览器内的域名解析，作为兜底。
- 以上之外的通道不在 flipbook 的保证范围内，比如 Worker 或 iframe 里绕开页面替换的代码、按 IP 直连的 TCP。执行来路不明的合成时，要靠进程级的网络限制（宿主沙箱、容器或防火墙）才能确保完全不联网，flipbook 本身不做这个承诺。
- flipbook 自己只在两种情况下联网：check 和 render 首次运行时下载钉死版本的 Chromium headless shell 和清单里的字体（校验 SHA-256）。doctor 永不联网、永不安装。
