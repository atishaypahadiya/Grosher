// The root error boundary: a render error shows the boot guard's plate (index.html: "Something went wrong",
// the error, Reload, Reset local data) instead of a blank screen. A chunk that failed to load is a stale
// build, not a bug: the guard reloads once. Where the guard is absent (tests), a minimal plate in React.

import { Component, type ReactNode } from "react";

declare global {
  interface Window {
    __grosherFail?: (err: unknown, where?: string) => void;
    /** reload once onto the current build; false when it already did within the minute (soft: no plate then) */
    __grosherRecover?: (reason: string, soft?: boolean) => boolean;
    __grosherIsChunkError?: (err: unknown) => boolean;
    __grosherBoot?: () => void;
    __grosherBooted?: boolean;
  }
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[grosher] render error", error, info.componentStack);
    if (window.__grosherIsChunkError?.(error)) window.__grosherRecover?.(error.message);
    else window.__grosherFail?.(error, "render");
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (window.__grosherFail) return null;
    return (
      <div role="alert" className="boot-fallback">
        <h1>Something went wrong</h1>
        <pre>{this.state.error.message}</pre>
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

/**
 * Around a lazily loaded part with a fallback (the 3D map → the flat map): a missing chunk reloads once onto
 * the current build like everywhere else; when that already happened, or the part fails for another reason,
 * the fallback renders instead of the plate.
 */
export class FallbackBoundary extends Component<{ children: ReactNode; fallback: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[grosher] ${this.props.name} failed; showing its fallback`, error);
    if (window.__grosherIsChunkError?.(error)) window.__grosherRecover?.(error.message, true);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
