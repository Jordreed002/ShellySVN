import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPreviewProvider } from './contexts/SettingsPreviewContext';
import { GlobalErrorBoundary } from './components/ErrorBoundary';

// Import styles
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
      staleTime: 1000 * 60 * 5, // 5 minutes
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
          <RouterProvider router={router} />
        </SettingsPreviewProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>
);
