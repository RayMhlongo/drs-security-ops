import React from 'react';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unknown runtime error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Runtime error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] p-6 grid place-items-center text-white bg-black">
          <div className="w-full max-w-lg rounded-2xl border border-red-500/50 bg-black/80 p-6 space-y-3">
            <h1 className="text-xl font-semibold">App Error</h1>
            <p className="text-sm text-white/80">The app hit an unexpected runtime error. Restart the app. If this continues, reinstall the latest APK.</p>
            <p className="text-xs text-white/60 break-all">{this.state.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
