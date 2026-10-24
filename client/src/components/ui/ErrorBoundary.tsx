import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Client rendering failed", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return this.props.fallback ?? (
        <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
          <section className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-slate-400">{this.state.error.message}</p>
            <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
