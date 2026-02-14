import { useState, useCallback, useEffect } from 'react'

/**
 * Commit template structure
 */
export interface CommitTemplate {
  id: string
  name: string
  description?: string
  template: string
  repositoryPath?: string // If undefined, it's a global template
  isDefault?: boolean
  createdAt: number
  updatedAt: number
}

/**
 * Template variable for substitution
 */
export interface TemplateVariable {
  name: string
  description: string
  example: string
  resolver: () => string | Promise<string>
}

/**
 * Built-in template variables
 */
const BUILTIN_VARIABLES: TemplateVariable[] = [
  {
    name: 'date',
    description: 'Current date in ISO format',
    example: '2026-02-14',
    resolver: () => new Date().toISOString().split('T')[0]
  },
  {
    name: 'time',
    description: 'Current time in HH:MM format',
    example: '22:42',
    resolver: () => new Date().toTimeString().slice(0, 5)
  },
  {
    name: 'datetime',
    description: 'Current date and time',
    example: '2026-02-14 22:42',
    resolver: () => {
      const now = new Date()
      return `${now.toISOString().split('T')[0]} ${now.toTimeString().slice(0, 5)}`
    }
  },
  {
    name: 'username',
    description: 'Current system username',
    example: 'developer',
    resolver: () => process.env.USER || process.env.USERNAME || 'unknown'
  },
  {
    name: 'hostname',
    description: 'Computer hostname',
    example: 'dev-machine',
    resolver: () => require('os').hostname()
  },
  {
    name: 'branch',
    description: 'Current branch name (from svn info)',
    example: 'trunk',
    resolver: () => 'trunk' // Would need svn info to get actual branch
  },
  {
    name: 'files',
    description: 'List of changed files (placeholder)',
    example: 'file1.ts, file2.ts',
    resolver: () => ''
  },
  {
    name: 'filecount',
    description: 'Number of changed files (placeholder)',
    example: '5',
    resolver: () => '0'
  }
]

/**
 * Storage key for templates
 */
const STORAGE_KEY = 'shellysvn-commit-templates'

/**
 * Hook for managing commit templates
 */
export function useCommitTemplates() {
  const [templates, setTemplates] = useState<CommitTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  /**
   * Load templates from storage
   */
  const loadTemplates = useCallback(async () => {
    setIsLoading(true)
    try {
      const stored = await window.api.store.get<CommitTemplate[]>(STORAGE_KEY)
      if (stored && stored.length > 0) {
        setTemplates(stored)
      } else {
        // Create default templates
        const defaults = createDefaultTemplates()
        setTemplates(defaults)
        await window.api.store.set(STORAGE_KEY, defaults)
      }
    } catch (error) {
      console.error('Failed to load commit templates:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  /**
   * Save templates to storage
   */
  const saveTemplates = useCallback(async (newTemplates: CommitTemplate[]) => {
    try {
      await window.api.store.set(STORAGE_KEY, newTemplates)
    } catch (error) {
      console.error('Failed to save commit templates:', error)
    }
  }, [])
  
  /**
   * Add a new template
   */
  const addTemplate = useCallback(async (template: Omit<CommitTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const newTemplate: CommitTemplate = {
      ...template,
      id: `template-${now}`,
      createdAt: now,
      updatedAt: now
    }
    
    const newTemplates = [...templates, newTemplate]
    setTemplates(newTemplates)
    await saveTemplates(newTemplates)
    
    return newTemplate
  }, [templates, saveTemplates])
  
  /**
   * Update an existing template
   */
  const updateTemplate = useCallback(async (id: string, updates: Partial<CommitTemplate>) => {
    const newTemplates = templates.map(t => 
      t.id === id 
        ? { ...t, ...updates, updatedAt: Date.now() }
        : t
    )
    setTemplates(newTemplates)
    await saveTemplates(newTemplates)
  }, [templates, saveTemplates])
  
  /**
   * Delete a template
   */
  const deleteTemplate = useCallback(async (id: string) => {
    const newTemplates = templates.filter(t => t.id !== id)
    setTemplates(newTemplates)
    await saveTemplates(newTemplates)
  }, [templates, saveTemplates])
  
  /**
   * Get templates for a specific repository
   */
  const getTemplatesForRepo = useCallback((repoPath: string): CommitTemplate[] => {
    return templates.filter(t => 
      t.repositoryPath === repoPath || t.repositoryPath === undefined
    )
  }, [templates])
  
  /**
   * Get the default template for a repository
   */
  const getDefaultTemplate = useCallback((repoPath?: string): CommitTemplate | undefined => {
    // First, check for repo-specific default
    const repoDefault = templates.find(t => 
      t.repositoryPath === repoPath && t.isDefault
    )
    if (repoDefault) return repoDefault
    
    // Then, check for global default
    return templates.find(t => 
      t.repositoryPath === undefined && t.isDefault
    )
  }, [templates])
  
  /**
   * Set a template as default
   */
  const setDefaultTemplate = useCallback(async (id: string) => {
    const newTemplates = templates.map(t => ({
      ...t,
      isDefault: t.id === id
    }))
    setTemplates(newTemplates)
    await saveTemplates(newTemplates)
  }, [templates, saveTemplates])
  
  /**
   * Apply a template with variable substitution
   */
  const applyTemplate = useCallback(async (
    templateId: string, 
    customVariables: Record<string, string> = {}
  ): Promise<string> => {
    const template = templates.find(t => t.id === templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }
    
    return applyTemplateString(template.template, customVariables)
  }, [templates])
  
  /**
   * Get available template variables
   */
  const getVariables = useCallback((): TemplateVariable[] => {
    return BUILTIN_VARIABLES
  }, [])
  
  // Load templates on mount
  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])
  
  return {
    templates,
    isLoading,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    getTemplatesForRepo,
    getDefaultTemplate,
    setDefaultTemplate,
    applyTemplate,
    getVariables,
    reload: loadTemplates
  }
}

/**
 * Apply variable substitution to a template string
 */
export async function applyTemplateString(
  template: string,
  customVariables: Record<string, string> = {}
): Promise<string> {
  let result = template
  
  // Apply built-in variables
  for (const variable of BUILTIN_VARIABLES) {
    const regex = new RegExp(`\\{\\{${variable.name}\\}\\}`, 'g')
    const value = await Promise.resolve(variable.resolver())
    result = result.replace(regex, value)
  }
  
  // Apply custom variables
  for (const [name, value] of Object.entries(customVariables)) {
    const regex = new RegExp(`\\{\\{${name}\\}\\}`, 'g')
    result = result.replace(regex, value)
  }
  
  return result
}

/**
 * Create default templates
 */
function createDefaultTemplates(): CommitTemplate[] {
  const now = Date.now()
  
  return [
    {
      id: 'default-simple',
      name: 'Simple',
      description: 'A simple commit message template',
      template: `{{description}}

Changed files:
{{files}}`,
      isDefault: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'default-detailed',
      name: 'Detailed',
      description: 'A detailed commit message with metadata',
      template: `{{type}}: {{description}}

## Summary
{{summary}}

## Changes
{{changes}}

## Testing
{{testing}}

---
Date: {{datetime}}
Author: {{username}}`,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'default-conventional',
      name: 'Conventional Commits',
      description: 'Follows the Conventional Commits specification',
      template: `{{type}}({{scope}}): {{description}}

{{body}}

{{footer}}`,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'default-bugfix',
      name: 'Bug Fix',
      description: 'Template for bug fix commits',
      template: `fix: {{description}}

## Issue
Fixes #{{issue}}

## Root Cause
{{rootCause}}

## Solution
{{solution}}

## Testing
{{testing}}`,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'default-feature',
      name: 'Feature',
      description: 'Template for new feature commits',
      template: `feat: {{description}}

## Overview
{{overview}}

## Implementation
{{implementation}}

## Breaking Changes
{{breakingChanges}}`,
      createdAt: now,
      updatedAt: now
    }
  ]
}

export default useCommitTemplates
