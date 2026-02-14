import { createFileRoute } from '@tanstack/react-router'
import { WelcomeScreen } from '@renderer/components/WelcomeScreen'

export const Route = createFileRoute('/')({
  component: WelcomeScreen
})
