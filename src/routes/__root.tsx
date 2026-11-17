import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import campusBackdropImg from "@/assets/images/campus_courtyard_backdrop_1794777399597.jpg";
import { KhaznaAssistant } from "@/components/khazna/KhaznaAssistant";
import { DynamicIsland } from "@/components/network/DynamicIsland";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            data-ai-id="not-found-go-home-link"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error("[RootErrorComponent] Caught runtime error:", error);
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);

  const handleHardReset = () => {
    try {
      sessionStorage.removeItem("khazna_super_admin_token");
      sessionStorage.removeItem("khazna_super_admin_user");
    } catch {
      // ignore
    }
    router.invalidate();
    window.location.href = "/";
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
          <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong while rendering this section. You can try refreshing or reset to the home view.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button
            data-ai-id="error-try-again-btn"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            data-ai-id="error-reset-home-btn"
            data-sensitive="true"
            onClick={handleHardReset}
            className="inline-flex items-center justify-center rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Reset & Go Home
          </button>
        </div>

        {Boolean(error) && (
          <div className="mt-6 text-left">
            <button
              data-ai-id="error-toggle-details-btn"
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetails ? "Hide technical details ↑" : "Show technical details ↓"}
            </button>
            {showDetails && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-black/40 p-3 text-xs text-red-400 font-mono border border-white/10 text-left">
                {error instanceof Error ? String(error.stack || error.message) : String(error)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { pathname } = useLocation();
  const isVerificationRoute = pathname.startsWith("/v/");

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  useEffect(() => {
    const splash = document.getElementById("khazna-fast-splash");
    if (splash) {
      if (isVerificationRoute) {
        splash.remove();
        return;
      }
      const timer = setTimeout(() => {
        splash.style.opacity = "0";
        splash.style.pointerEvents = "none";
        setTimeout(() => {
          splash.remove();
        }, 180);
      }, 40);
      return () => clearTimeout(timer);
    }
  }, [isVerificationRoute]);

  if (isVerificationRoute) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-backdrop" aria-hidden="true">
        <div className="app-backdrop-photo" style={{ backgroundImage: `url(${campusBackdropImg})` }} />
        <div className="app-backdrop-veil" />
        <div className="app-backdrop-orbs">
          <span />
          <span />
          <span />
        </div>
        <div className="app-backdrop-sheen" />
      </div>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <DynamicIsland />
      <Outlet />
      <Toaster position="bottom-left" richColors closeButton />
      <KhaznaAssistant />
    </QueryClientProvider>
  );
}
