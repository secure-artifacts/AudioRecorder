import React from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './styles.css';

function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

function showCurrentWindowForError() {
  if (!isTauriRuntime()) return;
  const appWindow = getCurrentWindow();
  appWindow
    .show()
    .then(() => appWindow.setFocus())
    .catch(() => {});
}

// 将各种错误统一格式化成可读文本，显示在启动调试面板里。
function formatError(error) {
  if (!error) return '未知错误';
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack || ''}`;
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

// 调试面板独立于 React root，避免 React 接管 DOM 时出现 removeChild 冲突。
function showBootError(title, error) {
  showCurrentWindowForError();
  const panel = document.getElementById('boot-panel');
  if (!panel) return;
  const message = formatError(error);
  panel.className = 'boot-panel boot-error';
  panel.innerHTML = `
    <h1>${title}</h1>
    <p>AudioRecorder 没有成功渲染。下面是窗口捕获到的错误信息，方便继续定位。</p>
    <pre id="boot-debug"></pre>
  `;
  const debug = document.getElementById('boot-debug');
  if (debug) debug.textContent = message;
}

function hideBootPanel() {
  document.getElementById('boot-panel')?.classList.add('boot-hidden');
}

// 捕获模块加载、异步初始化等 React 边界外错误。
window.addEventListener('error', (event) => {
  showBootError('运行时错误', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  showBootError('异步运行错误', event.reason);
});

// 捕获组件渲染阶段错误，避免窗口退回纯白屏。
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    showCurrentWindowForError();
    this.setState({ error, info });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="boot-panel boot-error">
          <h1>React 渲染错误</h1>
          <p>组件渲染阶段发生错误。</p>
          <pre id="boot-debug">
            {formatError(this.state.error)}
            {'\n\n组件堆栈：\n'}
            {this.state.info?.componentStack || '无组件堆栈'}
          </pre>
        </main>
      );
    }
    return this.props.children;
  }
}

// 动态导入 App，可以把 App.jsx 顶层错误也展示到调试面板。
async function boot() {
  try {
    const rootElement = document.getElementById('root');
    if (!rootElement) throw new Error('找不到 #root 挂载节点');
    const { default: App } = await import('./App.jsx');
    rootElement.replaceChildren();
    createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
    hideBootPanel();
  } catch (error) {
    showBootError('应用启动失败', error);
  }
}

boot();
