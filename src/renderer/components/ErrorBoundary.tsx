import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[Infinite OS] Render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0f] text-white p-8">
          <div className="max-w-md text-center">
            <div className="mb-6 text-4xl opacity-50">⚠</div>
            <h2 className="text-xl font-semibold mb-3">Something went wrong</h2>
            <p className="text-white/60 text-sm mb-6">
              Infinite OS encountered an unexpected error. Your work has been saved.
            </p>
            <p className="text-white/40 text-xs font-mono mb-6 p-3 bg-white/5 rounded-lg overflow-auto max-h-32">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 text-sm rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-colors"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
