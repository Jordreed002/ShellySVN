import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ModalPortalProps {
  children: React.ReactNode
}

/**
 * Portal component that renders children at the document body level.
 * This ensures modals are positioned correctly regardless of where
 * they are declared in the component tree.
 */
export function ModalPortal({ children }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])
  
  if (!mounted) return null
  
  return createPortal(children, document.body)
}

/**
 * Higher-order component to wrap any modal with a portal.
 * Usage: export const MyModalPortal = withModalPortal(MyModal)
 */
export function withModalPortal<P extends object>(
  Component: React.ComponentType<P>
): React.FC<P> {
  return function ModalWithPortal(props: P) {
    return (
      <ModalPortal>
        <Component {...props} />
      </ModalPortal>
    )
  }
}
