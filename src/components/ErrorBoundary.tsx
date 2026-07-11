import { Component, type ReactNode } from 'react';
import { log } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error): void {
    log(`ErrorBoundary: ${error.message}`);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-2xl font-bold">出了点问题</p>
        <p className="text-sm text-mute">你的数据都在本地，不会丢失。</p>
        {this.state.message && (
          <p className="max-w-full break-words rounded-lg bg-card px-3 py-2 font-mono text-xs text-mute">
            {this.state.message}
          </p>
        )}
        <button
          type="button"
          className="rounded-xl bg-iron px-6 py-3 font-semibold text-white active:scale-95"
          onClick={() => {
            // 先回到首页再重载，避免确定性渲染错误在原路由上无限崩溃
            window.location.hash = '#/';
            window.location.reload();
          }}
        >
          重新载入
        </button>
      </div>
    );
  }
}
