/**
 * @module @kekenik/ui/app/ErrorBoundary
 * Global ErrorBoundary ensuring errors are never silent and are recorded to the 500-line Log Viewer.
 */

import React from "react";
import { appLogger } from "../../../core/src/index.ts";

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class GlobalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  public constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  public override componentDidCatch(error: unknown): void {
    appLogger.error(
      "ErrorBoundary",
      error instanceof Error ? error.stack ?? error.message : String(error)
    );
  }

  public override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen bg-[#27222b] text-white font-mono flex items-center justify-center p-6">
          <div className="max-w-lg w-full border-2 border-black bg-[#c9c1b9] text-black p-4 space-y-3 shadow-2xl">
            <div className="text-sm font-bold text-red-700">
              Kekenik Pixel — Unhandled UI Error Caught
            </div>
            <pre className="p-2 bg-black text-red-300 text-xs overflow-x-auto">
              {this.state.message}
            </pre>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="px-3 py-1 bg-[#6a8190] text-white text-xs font-bold border border-black"
            >
              Recover UI Session
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
