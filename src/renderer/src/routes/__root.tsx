import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Layout } from '@renderer/components/Layout'

export const Route = createRootRoute({
  component: () => (
    <Layout>
      <Suspense fallback={<div className="loading">Loading...</div>}>
        <Outlet />
      </Suspense>
    </Layout>
  )
})
