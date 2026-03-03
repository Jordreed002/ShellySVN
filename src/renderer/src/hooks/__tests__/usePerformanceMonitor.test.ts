import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  usePerformanceMonitor,
  formatBytes,
  formatDuration,
  DEFAULT_THRESHOLDS
} from '../usePerformanceMonitor'

describe('usePerformanceMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      expect(result.current.metrics).toEqual([])
      expect(result.current.memory).toBeNull()
      expect(result.current.fps).toBe(60)
      expect(result.current.fpsHistory).toEqual([])
      expect(result.current.alerts).toEqual([])
      expect(result.current.isOperationRunning).toBe(false)
    })

    it('should use default thresholds when none provided', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      expect(result.current.thresholds).toEqual(DEFAULT_THRESHOLDS)
    })

    it('should merge custom thresholds with defaults', () => {
      const { result } = renderHook(() =>
        usePerformanceMonitor({
          thresholds: {
            maxScanTime: 5000,
            maxMemoryMB: 1024
          }
        })
      )

      expect(result.current.thresholds.maxScanTime).toBe(5000)
      expect(result.current.thresholds.maxMemoryMB).toBe(1024)
      expect(result.current.thresholds.minFps).toBe(DEFAULT_THRESHOLDS.minFps)
    })
  })

  describe('startMetric / endMetric', () => {
    it('should start a metric and return an ID', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let metricId: string = ''
      act(() => {
        metricId = result.current.startMetric('test-operation', 'scan')
      })

      expect(metricId).toBeTruthy()
      expect(metricId).toMatch(/^metric-\d+$/)
    })

    it('should track running metrics', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      act(() => {
        result.current.startMetric('test-operation', 'scan')
      })

      expect(result.current.isOperationRunning).toBe(true)
      expect(result.current.metrics).toHaveLength(1)
      expect(result.current.metrics[0].isRunning).toBe(true)
    })

    it('should end a metric and calculate duration', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let metricId: string = ''
      act(() => {
        metricId = result.current.startMetric('test-operation', 'scan')
      })

      // Advance time by 100ms
      vi.advanceTimersByTime(100)

      act(() => {
        result.current.endMetric(metricId)
      })

      expect(result.current.isOperationRunning).toBe(false)
      expect(result.current.metrics[0].isRunning).toBe(false)
      // Duration should be at least 100ms (with tolerance for timing variations)
      expect(result.current.metrics[0].duration).toBeGreaterThanOrEqual(100)
    })

    it('should store metadata with metrics', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let metricId: string = ''
      act(() => {
        metricId = result.current.startMetric('test-operation', 'scan', {
          fileCount: 1000
        })
      })

      act(() => {
        result.current.endMetric(metricId, { success: true })
      })

      expect(result.current.metrics[0].metadata).toEqual({
        fileCount: 1000,
        success: true
      })
    })

    it('should not track metrics when disabled', () => {
      const { result } = renderHook(() =>
        usePerformanceMonitor({ enabled: false })
      )

      let metricId: string = ''
      act(() => {
        metricId = result.current.startMetric('test-operation', 'scan')
      })

      expect(metricId).toBe('')
      expect(result.current.metrics).toHaveLength(0)
    })
  })

  describe('measureSync', () => {
    it('should measure synchronous function execution', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let returnValue: number = 0
      act(() => {
        returnValue = result.current.measureSync('sync-op', 'render', () => {
          return 42
        })
      })

      expect(returnValue).toBe(42)
      // The hook updates the metric in place, so we should have 1 completed metric
      expect(result.current.metrics).toHaveLength(1)
      expect(result.current.metrics[0].name).toBe('sync-op')
      expect(result.current.metrics[0].isRunning).toBe(false)
    })

    it('should track errors in sync functions', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      act(() => {
        expect(() => {
          result.current.measureSync('failing-op', 'render', () => {
            throw new Error('Test error')
          })
        }).toThrow('Test error')
      })

      // Need to wait for state update
      const completedMetric = result.current.metrics.find(m => !m.isRunning)
      expect(completedMetric?.metadata?.error).toBe(true)
    })
  })

  describe('measureAsync', () => {
    it('should measure async function execution', async () => {
      vi.useRealTimers() // Use real timers for async test
      const { result } = renderHook(() => usePerformanceMonitor())

      let returnValue: number = 0
      await act(async () => {
        returnValue = await result.current.measureAsync('async-op', 'network', async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return 42
        })
      })

      expect(returnValue).toBe(42)
      const completedMetric = result.current.metrics.find(m => !m.isRunning)
      expect(completedMetric?.name).toBe('async-op')
      vi.useFakeTimers()
    })
  })

  describe('alerts', () => {
    it('should generate alert when scan time exceeds threshold', async () => {
      vi.useRealTimers() // Use real timers for this test
      const onAlert = vi.fn()
      const { result } = renderHook(() =>
        usePerformanceMonitor({
          thresholds: { maxScanTime: 1 }, // Very low threshold
          onAlert
        })
      )

      let metricId: string = ''
      act(() => {
        metricId = result.current.startMetric('status-scan', 'scan')
      })

      // Wait to exceed threshold
      await new Promise(resolve => setTimeout(resolve, 50))

      act(() => {
        result.current.endMetric(metricId, { fileCount: 10000 })
      })

      expect(onAlert).toHaveBeenCalled()
      expect(result.current.alerts.length).toBeGreaterThan(0)
      vi.useFakeTimers()
    })

    it('should generate critical alert when significantly exceeding threshold', async () => {
      vi.useRealTimers() // Use real timers for this test
      const onAlert = vi.fn()
      const { result } = renderHook(() =>
        usePerformanceMonitor({
          thresholds: { maxScanTime: 1 },
          onAlert
        })
      )

      let metricId: string = ''
      act(() => {
        metricId = result.current.startMetric('status-scan', 'scan')
      })

      // Wait to exceed threshold significantly
      await new Promise(resolve => setTimeout(resolve, 100))

      act(() => {
        result.current.endMetric(metricId)
      })

      // Should be critical because 100ms > 1ms * 1.5
      const criticalAlert = result.current.alerts.find(a => a.type === 'critical')
      expect(criticalAlert).toBeDefined()
      vi.useFakeTimers()
    })
  })

  describe('summary statistics', () => {
    it('should calculate average scan time', async () => {
      vi.useRealTimers()
      const { result } = renderHook(() => usePerformanceMonitor())

      let id1: string = ''
      let id2: string = ''
      act(() => {
        id1 = result.current.startMetric('scan1', 'scan')
        id2 = result.current.startMetric('scan2', 'scan')
      })

      await new Promise(resolve => setTimeout(resolve, 50))

      act(() => {
        result.current.endMetric(id1)
        result.current.endMetric(id2)
      })

      expect(result.current.summary.avgScanTime).toBeGreaterThan(0)
      vi.useFakeTimers()
    })

    it('should track failed operations', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let metricId: string = ''
      act(() => {
        metricId = result.current.startMetric('failing-scan', 'scan')
      })

      act(() => {
        result.current.endMetric(metricId, { error: true })
      })

      expect(result.current.summary.failedOperations).toBe(1)
    })

    it('should count total operations', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let id1: string = ''
      let id2: string = ''
      act(() => {
        id1 = result.current.startMetric('op1', 'scan')
        id2 = result.current.startMetric('op2', 'render')
      })

      act(() => {
        result.current.endMetric(id1)
        result.current.endMetric(id2)
      })

      expect(result.current.summary.totalOperations).toBe(2)
    })
  })

  describe('utility functions', () => {
    it('should clear metrics', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let metricId: string = ''
      act(() => {
        metricId = result.current.startMetric('test', 'scan')
      })

      act(() => {
        result.current.endMetric(metricId)
      })

      expect(result.current.metrics.length).toBeGreaterThan(0)

      act(() => {
        result.current.clearMetrics()
      })

      expect(result.current.metrics).toHaveLength(0)
      expect(result.current.alerts).toHaveLength(0)
    })

    it('should filter metrics by category', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let id1: string = ''
      let id2: string = ''
      let id3: string = ''
      act(() => {
        id1 = result.current.startMetric('scan1', 'scan')
        id2 = result.current.startMetric('render1', 'render')
        id3 = result.current.startMetric('scan2', 'scan')
      })

      act(() => {
        result.current.endMetric(id1)
        result.current.endMetric(id2)
        result.current.endMetric(id3)
      })

      const scanMetrics = result.current.getMetricsByCategory('scan')
      expect(scanMetrics.length).toBeGreaterThanOrEqual(2)
      expect(scanMetrics.every(m => m.category === 'scan')).toBe(true)
    })

    it('should filter metrics by name', () => {
      const { result } = renderHook(() => usePerformanceMonitor())

      let id1: string = ''
      let id2: string = ''
      let id3: string = ''
      act(() => {
        id1 = result.current.startMetric('status-scan', 'scan')
        id2 = result.current.startMetric('other-op', 'render')
        id3 = result.current.startMetric('status-scan', 'scan')
      })

      act(() => {
        result.current.endMetric(id1)
        result.current.endMetric(id2)
        result.current.endMetric(id3)
      })

      const statusMetrics = result.current.getMetricsByName('status-scan')
      expect(statusMetrics.length).toBeGreaterThanOrEqual(2)
      expect(statusMetrics.every(m => m.name === 'status-scan')).toBe(true)
    })
  })

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B')
      expect(formatBytes(500)).toBe('500 B')
      expect(formatBytes(1024)).toBe('1 KB')
      expect(formatBytes(1536)).toBe('1.5 KB')
      expect(formatBytes(1048576)).toBe('1 MB')
      expect(formatBytes(1572864)).toBe('1.5 MB')
      expect(formatBytes(1073741824)).toBe('1 GB')
    })
  })

  describe('formatDuration', () => {
    it('should format duration correctly', () => {
      expect(formatDuration(0.001)).toMatch(/μs/)
      expect(formatDuration(0.5)).toMatch(/μs/) // 0.5ms < 1ms shows as microseconds
      expect(formatDuration(5)).toBe('5.0ms') // values < 10 get one decimal
      expect(formatDuration(100)).toBe('100ms')
      expect(formatDuration(1500)).toBe('1.50s')
      expect(formatDuration(65000)).toBe('1m 5s')
    })
  })
})

describe('DEFAULT_THRESHOLDS', () => {
  it('should have required performance targets', () => {
    expect(DEFAULT_THRESHOLDS.maxScanTime).toBe(3000) // 3 seconds for 100k files
    expect(DEFAULT_THRESHOLDS.maxMemoryMB).toBe(500)  // 500MB max
    expect(DEFAULT_THRESHOLDS.minFps).toBe(55)        // Near 60fps
    expect(DEFAULT_THRESHOLDS.maxRenderTime).toBe(16.67) // One frame
  })
})
