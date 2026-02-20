import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom'

import { Toolbar } from '../src/components/ui/Toolbar'

describe('Toolbar - Show Remote Items Toggle', () => {
  const mockOnToggleRemoteItems = vi.fn()
  
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the remote items toggle button when versioned and in local mode', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
      />
    )
    
    expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
  })

  it('does not render the toggle when not versioned', () => {
    render(
      <Toolbar
        isVersioned={false}
        browseMode="local"
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
      />
    )
    
    expect(screen.queryByTitle('Show remote items (sparse checkout)')).not.toBeInTheDocument()
  })

  it('does not render the toggle when in online mode', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="online"
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
      />
    )
    
    expect(screen.queryByTitle('Show remote items (sparse checkout)')).not.toBeInTheDocument()
  })

  it('calls onToggleRemoteItems when clicked', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
      />
    )
    
    const toggleButton = screen.getByTitle('Show remote items (sparse checkout)')
    fireEvent.click(toggleButton)
    
    expect(mockOnToggleRemoteItems).toHaveBeenCalledTimes(1)
  })

  it('shows active state when remote items are shown', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        showRemoteItems={true}
        onToggleRemoteItems={mockOnToggleRemoteItems}
      />
    )
    
    const toggleButton = screen.getByTitle('Hide remote items')
    expect(toggleButton).toHaveClass('text-info')
    expect(toggleButton).toHaveClass('bg-info/10')
  })

  it('shows correct title when remote items are shown', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        showRemoteItems={true}
        onToggleRemoteItems={mockOnToggleRemoteItems}
      />
    )
    
    expect(screen.getByTitle('Hide remote items')).toBeInTheDocument()
  })
})

describe('Toolbar - Browse Mode Toggle Integration', () => {
  const mockOnBrowseModeChange = vi.fn()
  const mockOnToggleRemoteItems = vi.fn()
  
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows both local/online toggle and remote items toggle when canBrowseOnline is true', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="local"
        canBrowseOnline={true}
        onBrowseModeChange={mockOnBrowseModeChange}
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
      />
    )
    
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.getByTitle('Show remote items (sparse checkout)')).toBeInTheDocument()
  })

  it('remote items toggle is hidden when in online mode', () => {
    render(
      <Toolbar
        isVersioned={true}
        browseMode="online"
        canBrowseOnline={true}
        onBrowseModeChange={mockOnBrowseModeChange}
        showRemoteItems={false}
        onToggleRemoteItems={mockOnToggleRemoteItems}
      />
    )
    
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.queryByTitle('Show remote items (sparse checkout)')).not.toBeInTheDocument()
  })
})
