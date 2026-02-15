import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Plugin manifest
 */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  homepage?: string
  repository?: string
  main: string
  icon?: string
  permissions: PluginPermission[]
  hooks: string[]
  contributes?: {
    commands?: PluginCommand[]
    menus?: PluginMenuItem[]
    themes?: string[]
    settings?: PluginSetting[]
  }
}

/**
 * Plugin permission types
 */
export type PluginPermission = 
  | 'fs:read'
  | 'fs:write'
  | 'svn:read'
  | 'svn:write'
  | 'ui:read'
  | 'ui:write'
  | 'network'
  | 'clipboard'

/**
 * Plugin command contribution
 */
export interface PluginCommand {
  id: string
  title: string
  category?: string
  icon?: string
  keybinding?: string
}

/**
 * Plugin menu contribution
 */
export interface PluginMenuItem {
  id: string
  title: string
  parent?: string
  group?: string
  command: string
  when?: string
}

/**
 * Plugin setting
 */
export interface PluginSetting {
  key: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  default: unknown
  description?: string
  enum?: string[]
}

/**
 * Loaded plugin instance
 */
export interface PluginInstance {
  manifest: PluginManifest
  enabled: boolean
  installed: boolean
  settings: Record<string, unknown>
  activated: boolean
  error?: string
}

/**
 * Plugin API exposed to plugins
 */
export interface PluginAPI {
  // SVN operations
  svn: {
    status: (path: string) => Promise<unknown>
    log: (path: string, limit?: number) => Promise<unknown>
    diff: (path: string) => Promise<unknown>
    commit: (paths: string[], message: string) => Promise<unknown>
    update: (path: string) => Promise<unknown>
  }
  
  // File system
  fs: {
    readFile: (path: string) => Promise<string>
    writeFile: (path: string, content: string) => Promise<void>
    listDirectory: (path: string) => Promise<string[]>
  }
  
  // UI
  ui: {
    showMessage: (message: string, type?: 'info' | 'warning' | 'error') => void
    showInput: (prompt: string, defaultValue?: string) => Promise<string | null>
    refreshUI: () => void
  }
  
  // Settings
  settings: {
    get: (key: string) => unknown
    set: (key: string, value: unknown) => void
  }
}

/**
 * Plugin hook handler
 */
export type PluginHookHandler = (data: unknown, api: PluginAPI) => unknown | Promise<unknown>

const STORAGE_KEY = 'shellysvn-plugins'

/**
 * Hook for managing plugins
 */
export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginInstance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const handlersRef = useRef<Map<string, Map<string, PluginHookHandler>>>(new Map())
  
  /**
   * Load plugins from storage
   */
  const loadPlugins = useCallback(async () => {
    setIsLoading(true)
    try {
      const stored = await window.api.store.get<PluginInstance[]>(STORAGE_KEY)
      if (stored) {
        setPlugins(stored)
      }
    } catch (error) {
      console.error('Failed to load plugins:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  /**
   * Save plugins to storage
   */
  const savePlugins = useCallback(async (newPlugins: PluginInstance[]) => {
    try {
      await window.api.store.set(STORAGE_KEY, newPlugins)
    } catch (error) {
      console.error('Failed to save plugins:', error)
    }
  }, [])
  
  /**
   * Create plugin API
   */
  const createPluginAPI = useCallback((plugin: PluginInstance): PluginAPI => {
    return {
      svn: {
        status: async (path: string) => {
          if (!plugin.manifest.permissions.includes('svn:read')) {
            throw new Error('Plugin does not have svn:read permission')
          }
          return window.api.svn.status(path)
        },
        log: async (path: string, limit?: number) => {
          if (!plugin.manifest.permissions.includes('svn:read')) {
            throw new Error('Plugin does not have svn:read permission')
          }
          return window.api.svn.log(path, limit)
        },
        diff: async (path: string) => {
          if (!plugin.manifest.permissions.includes('svn:read')) {
            throw new Error('Plugin does not have svn:read permission')
          }
          return window.api.svn.diff(path)
        },
        commit: async (paths: string[], message: string) => {
          if (!plugin.manifest.permissions.includes('svn:write')) {
            throw new Error('Plugin does not have svn:write permission')
          }
          return window.api.svn.commit(paths, message)
        },
        update: async (path: string) => {
          if (!plugin.manifest.permissions.includes('svn:write')) {
            throw new Error('Plugin does not have svn:write permission')
          }
          return window.api.svn.update(path)
        }
      },
      fs: {
        readFile: async (path: string) => {
          if (!plugin.manifest.permissions.includes('fs:read')) {
            throw new Error('Plugin does not have fs:read permission')
          }
          const result = await window.api.fs.readFile(path)
          return result.content || ''
        },
        writeFile: async (path: string, content: string) => {
          if (!plugin.manifest.permissions.includes('fs:write')) {
            throw new Error('Plugin does not have fs:write permission')
          }
          const result = await window.api.fs.writeFile(path, content)
          if (!result.success) {
            throw new Error(result.error || 'Failed to write file')
          }
        },
        listDirectory: async (path: string) => {
          if (!plugin.manifest.permissions.includes('fs:read')) {
            throw new Error('Plugin does not have fs:read permission')
          }
          const files = await window.api.fs.listDirectory(path)
          return files.map(f => f.path)
        }
      },
      ui: {
        showMessage: (message: string, type: 'info' | 'warning' | 'error' = 'info') => {
          // Dispatch custom event for toast system
          window.dispatchEvent(new CustomEvent('shelly:toast', {
            detail: { message, type, pluginId: plugin.manifest.id }
          }))
        },
        showInput: async (promptText: string, defaultValue?: string) => {
          // Implementation would show input dialog
          return window.prompt(promptText, defaultValue || '') || null
        },
        refreshUI: () => {
          // Dispatch refresh event
          window.dispatchEvent(new CustomEvent('shelly:refresh', {
            detail: { pluginId: plugin.manifest.id }
          }))
        }
      },
      settings: {
        get: (key: string) => plugin.settings[key],
        set: (key: string, value: unknown) => {
          plugin.settings[key] = value
        }
      }
    }
  }, [])
  
  /**
   * Install plugin from manifest
   */
  const installPlugin = useCallback(async (manifest: PluginManifest): Promise<PluginInstance> => {
    const plugin: PluginInstance = {
      manifest,
      enabled: false,
      installed: true,
      settings: {},
      activated: false
    }
    
    // Initialize default settings
    if (manifest.contributes?.settings) {
      for (const setting of manifest.contributes.settings) {
        plugin.settings[setting.key] = setting.default
      }
    }
    
    const newPlugins = [...plugins, plugin]
    setPlugins(newPlugins)
    await savePlugins(newPlugins)
    
    return plugin
  }, [plugins, savePlugins])
  
  /**
   * Uninstall plugin
   */
  const uninstallPlugin = useCallback(async (pluginId: string): Promise<void> => {
    const plugin = plugins.find(p => p.manifest.id === pluginId)
    if (plugin?.activated) {
      // Deactivate first
      await deactivatePlugin(pluginId)
    }
    
    const newPlugins = plugins.filter(p => p.manifest.id !== pluginId)
    setPlugins(newPlugins)
    await savePlugins(newPlugins)
  }, [plugins, savePlugins])
  
  /**
   * Enable/disable plugin
   */
  const setPluginEnabled = useCallback(async (pluginId: string, enabled: boolean): Promise<void> => {
    const newPlugins = plugins.map(p => 
      p.manifest.id === pluginId ? { ...p, enabled } : p
    )
    setPlugins(newPlugins)
    await savePlugins(newPlugins)
  }, [plugins, savePlugins])
  
  /**
   * Activate plugin (load and run)
   */
  const activatePlugin = useCallback(async (pluginId: string): Promise<void> => {
    const plugin = plugins.find(p => p.manifest.id === pluginId)
    if (!plugin || plugin.activated) return
    
    try {
      // Initialize hook handlers map for this plugin
      // API will be created when executing hooks
      handlersRef.current.set(pluginId, new Map())
      
      // Mark as activated
      const newPlugins = plugins.map(p => 
        p.manifest.id === pluginId ? { ...p, activated: true, error: undefined } : p
      )
      setPlugins(newPlugins)
      await savePlugins(newPlugins)
    } catch (error) {
      const newPlugins = plugins.map(p => 
        p.manifest.id === pluginId ? { ...p, error: String(error) } : p
      )
      setPlugins(newPlugins)
    }
  }, [plugins, savePlugins, createPluginAPI])
  
  /**
   * Deactivate plugin
   */
  const deactivatePlugin = useCallback(async (pluginId: string): Promise<void> => {
    const plugin = plugins.find(p => p.manifest.id === pluginId)
    if (!plugin || !plugin.activated) return
    
    // Clear handlers
    handlersRef.current.delete(pluginId)
    
    const newPlugins = plugins.map(p => 
      p.manifest.id === pluginId ? { ...p, activated: false } : p
    )
    setPlugins(newPlugins)
    await savePlugins(newPlugins)
  }, [plugins, savePlugins])
  
  /**
   * Register hook handler
   */
  const registerHook = useCallback((
    pluginId: string,
    hook: string,
    handler: PluginHookHandler
  ): void => {
    const pluginHandlers = handlersRef.current.get(pluginId)
    if (pluginHandlers) {
      pluginHandlers.set(hook, handler)
    }
  }, [])
  
  /**
   * Execute hook
   */
  const executeHook = useCallback(async (
    hook: string,
    data: unknown
  ): Promise<unknown[]> => {
    const results: unknown[] = []
    
    for (const plugin of plugins) {
      if (!plugin.enabled || !plugin.activated) continue
      
      const pluginHandlers = handlersRef.current.get(plugin.manifest.id)
      if (!pluginHandlers) continue
      
      const handler = pluginHandlers.get(hook)
      if (handler && plugin.manifest.hooks.includes(hook)) {
        try {
          const api = createPluginAPI(plugin)
          const result = await handler(data, api)
          results.push(result)
        } catch (error) {
          console.error(`Plugin ${plugin.manifest.id} hook error:`, error)
        }
      }
    }
    
    return results
  }, [plugins, createPluginAPI])
  
  /**
   * Get plugin commands
   */
  const getCommands = useCallback((): PluginCommand[] => {
    const commands: PluginCommand[] = []
    
    for (const plugin of plugins) {
      if (!plugin.enabled || !plugin.activated) continue
      
      if (plugin.manifest.contributes?.commands) {
        commands.push(...plugin.manifest.contributes.commands.map(cmd => ({
          ...cmd,
          id: `${plugin.manifest.id}.${cmd.id}`
        })))
      }
    }
    
    return commands
  }, [plugins])
  
  // Load on mount
  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])
  
  return {
    plugins,
    isLoading,
    installPlugin,
    uninstallPlugin,
    setPluginEnabled,
    activatePlugin,
    deactivatePlugin,
    registerHook,
    executeHook,
    getCommands
  }
}

export default usePlugins
