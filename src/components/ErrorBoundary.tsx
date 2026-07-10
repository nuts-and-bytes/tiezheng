import { Component, type ReactNode } from 'react';
import { log } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
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
        <button
          type="button"
          className="rounded-xl bg-iron px-6 py-3 font-semibold text-white active:scale-95"
          onClick={() => window.location.reload()}
        >
          重新载入
        </button>
      </div>
    );
  }
}
