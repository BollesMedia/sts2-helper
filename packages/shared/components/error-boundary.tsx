"use client";

import { Component, type ReactNode } from "react";
import { reportError } from "../lib/error-reporter";

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

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportError("desktop_crash", error.message, {
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-1 items-center justify-center min-h-screen">
          <div className="text-center space-y-4 max-w-md">
            <h2 className="text-xl font-semibold text-zinc-200">
              Something went wrong
            </h2>
            <p className="text-sm text-zinc-500">
              {this.state.error?.message ?? "An unexpected error occurred"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="rounded-lg bg-zinc-100 px-6 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
