import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPreviewProvider } from './contexts/SettingsPreviewContext';
import { GlobalErrorBoundary } from './components/ErrorBoundary';
import { AppMotionProvider } from './lib/AppMotionProvider';
import { DEFAULT_QUERY_STALE_TIME_MS } from '@shared/constants';

// Import styles.
//
// Fonts: Archivo (sans) and JetBrains Mono (mono) are self-hosted — the app's CSP is
// `default-src 'self'`, so a Google Fonts <link> would be blocked and silently fall back
// to the system UI font. The woff2 files ship in @fontsource-variable/archivo and
// @fontsource-variable/jetbrains-mono; global.css declares @font-face against the `latin`
// subset only (importing the packages' own CSS here would pull in the cyrillic/greek/
// latin-ext/vietnamese subsets too, roughly doubling the shipped font weight).
import './styles/global.css';

// Import the generated route tree
import { routeTree } from './routeTree.gen';

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Create a query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_QUERY_STALE_TIME_MS,
      retry: 1,
    },
  },
});

// Global error handler for logging
const handleGlobalError = (error: Error, errorInfo: React.ErrorInfo) => {
  // Log to console in development
  if (import.meta.env.DEV) {
    console.error('Global error caught:', error);
    console.error('Component stack:', errorInfo.componentStack);
  }

  // In production, you could send this to an error tracking service
  // Example: Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } })
};

// Render the app
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalErrorBoundary onError={handleGlobalError} maxRetries={3}>
      <QueryClientProvider client={queryClient}>
        <SettingsPreviewProvider>
          <AppMotionProvider>
            <RouterProvider router={router} />
          </AppMotionProvider>
        </SettingsPreviewProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>
);
