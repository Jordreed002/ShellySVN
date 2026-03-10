import { useState, useCallback, useMemo } from 'react';
import {
  Activity,
  HardDrive,
  Clock,
  AlertTriangle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Trash2,
  TrendingUp,
  TrendingDown,
  Minus,
  XCircle,
  CheckCircle2,
  Gauge,
  Timer,
} from 'lucide-react';
import {
  usePerformanceMonitor,
  formatBytes,
  formatDuration,
  type PerformanceMetric,
  type PerformanceAlert,
  type MemorySnapshot,
  type PerformanceThresholds,
} from '@renderer/hooks/usePerformanceMonitor';

/**
 * Props for PerformanceDashboard component
 */
export interface PerformanceDashboardProps {
  /** Whether the dashboard is visible */
  visible?: boolean;
  /** Callback when dashboard is closed */
  onClose?: () => void;
  /** Custom thresholds to display */
  thresholds?: Partial<PerformanceThresholds>;
  /** Whether to show detailed metrics */
  detailed?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Performance Dashboard Component
 *
 * Displays real-time performance metrics for large repository operations:
 * - Memory usage with trend indicator
 * - Frame rate for 60fps scrolling verification
 * - Operation timing (scan, render, network)
 * - Active alerts when thresholds are exceeded
 * - Historical metrics with filtering
 *
 * @example
 * ```tsx
 * <PerformanceDashboard
 *   visible={showPerf}
 *   onClose={() => setShowPerf(false)}
 *   detailed
 * />
 * ```
 */
export function PerformanceDashboard({
  visible = true,
  onClose,
  thresholds = {},
  detailed = false,
  className = '',
}: PerformanceDashboardProps) {
  const {
    metrics,
    memory,
    memoryHistory,
    fps,
    fpsHistory,
    alerts,
    isOperationRunning,
    summary,
    clearMetrics,
    getMetricsByCategory,
    thresholds: activeThresholds,
  } = usePerformanceMonitor({
    thresholds,
    onAlert: (alert) => {
      console.log(`[Performance ${alert.type.toUpperCase()}] ${alert.message}`);
    },
  });

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    memory: true,
    fps: true,
    operations: true,
    alerts: true,
  });

  const [selectedCategory, setSelectedCategory] = useState<PerformanceMetric['category'] | 'all'>(
    'all'
  );

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  // Filter metrics by category
  const filteredMetrics = useMemo(() => {
    if (selectedCategory === 'all') return metrics;
    return getMetricsByCategory(selectedCategory);
  }, [metrics, selectedCategory, getMetricsByCategory]);

  // Calculate memory trend
  const memoryTrend = useMemo(() => {
    if (memoryHistory.length < 2) return 'stable';
    const recent = memoryHistory.slice(-5);
    const avgRecent = recent.reduce((sum, m) => sum + m.usedJSHeapSize, 0) / recent.length;
    const older = memoryHistory.slice(0, -5);
    if (older.length === 0) return 'stable';
    const avgOlder = older.reduce((sum, m) => sum + m.usedJSHeapSize, 0) / older.length;

    const change = (avgRecent - avgOlder) / avgOlder;
    if (change > 0.05) return 'up';
    if (change < -0.05) return 'down';
    return 'stable';
  }, [memoryHistory]);

  // Calculate FPS trend
  const fpsTrend = useMemo(() => {
    if (fpsHistory.length < 2) return 'stable';
    const recent = fpsHistory.slice(-5);
    const avgRecent = recent.reduce((sum, f) => sum + f.fps, 0) / recent.length;
    const older = fpsHistory.slice(0, -5);
    if (older.length === 0) return 'stable';
    const avgOlder = older.reduce((sum, f) => sum + f.fps, 0) / older.length;

    if (avgRecent < avgOlder - 3) return 'down';
    if (avgRecent > avgOlder + 3) return 'up';
    return 'stable';
  }, [fpsHistory]);

  // Count alerts by type
  const alertCounts = useMemo(() => {
    const warnings = alerts.filter((a) => a.type === 'warning').length;
    const critical = alerts.filter((a) => a.type === 'critical').length;
    return { warnings, critical, total: warnings + critical };
  }, [alerts]);

  if (!visible) return null;

  return (
    <div className={`bg-slate-900 text-white rounded-lg shadow-2xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="bg-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          <h2 className="font-semibold">Performance Monitor</h2>
          {isOperationRunning && (
            <span className="flex items-center gap-1 text-xs text-yellow-400 ml-2">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Running
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearMetrics}
            className="p-1.5 hover:bg-slate-700 rounded transition-colors"
            title="Clear all metrics"
            aria-label="Clear all metrics"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-700 rounded transition-colors"
              title="Close dashboard"
              aria-label="Close dashboard"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-px bg-slate-700">
        <SummaryCard
          icon={<HardDrive className="w-4 h-4" />}
          label="Memory"
          value={memory ? formatBytes(memory.usedJSHeapSize) : 'N/A'}
          subValue={
            memory ? `${((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(0)}%` : ''
          }
          status={getMemoryStatus(memory, activeThresholds.maxMemoryMB)}
          trend={memoryTrend}
        />
        <SummaryCard
          icon={<Gauge className="w-4 h-4" />}
          label="FPS"
          value={`${fps}`}
          subValue="target: 60"
          status={getFpsStatus(fps, activeThresholds.minFps)}
          trend={fpsTrend}
        />
        <SummaryCard
          icon={<Timer className="w-4 h-4" />}
          label="Avg Scan"
          value={formatDuration(summary.avgScanTime)}
          subValue={`threshold: ${formatDuration(activeThresholds.maxScanTime)}`}
          status={getScanStatus(summary.avgScanTime, activeThresholds.maxScanTime)}
        />
        <SummaryCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Alerts"
          value={`${alertCounts.total}`}
          subValue={`${alertCounts.critical} critical`}
          status={
            alertCounts.critical > 0 ? 'critical' : alertCounts.warnings > 0 ? 'warning' : 'good'
          }
        />
      </div>

      {/* Expandable Sections */}
      <div className="divide-y divide-slate-700">
        {/* Memory Section */}
        <ExpandableSection
          title="Memory Usage"
          icon={<HardDrive className="w-4 h-4" />}
          expanded={expandedSections.memory}
          onToggle={() => toggleSection('memory')}
        >
          {memory ? (
            <div className="space-y-3">
              <MemoryBar memory={memory} maxMemoryMB={activeThresholds.maxMemoryMB} />
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-slate-400">Used</span>
                  <p className="font-mono">{formatBytes(memory.usedJSHeapSize)}</p>
                </div>
                <div>
                  <span className="text-slate-400">Total Heap</span>
                  <p className="font-mono">{formatBytes(memory.totalJSHeapSize)}</p>
                </div>
                <div>
                  <span className="text-slate-400">Limit</span>
                  <p className="font-mono">{formatBytes(memory.jsHeapSizeLimit)}</p>
                </div>
              </div>
              {detailed && memory.domNodes !== undefined && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">DOM Nodes</span>
                    <p className="font-mono">{memory.domNodes.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Event Listeners</span>
                    <p className="font-mono">{memory.eventListeners?.toLocaleString() ?? 'N/A'}</p>
                  </div>
                </div>
              )}
              {detailed && memoryHistory.length > 1 && (
                <SparklineChart
                  data={memoryHistory.map((m) => m.usedJSHeapSize / (1024 * 1024))}
                  label="Memory (MB)"
                  color="#60a5fa"
                />
              )}
            </div>
          ) : (
            <p className="text-slate-400 text-sm">Memory API not available</p>
          )}
        </ExpandableSection>

        {/* FPS Section */}
        <ExpandableSection
          title="Frame Rate"
          icon={<Gauge className="w-4 h-4" />}
          expanded={expandedSections.fps}
          onToggle={() => toggleSection('fps')}
        >
          <div className="space-y-3">
            <FpsBar fps={fps} minFps={activeThresholds.minFps} />
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-slate-400">Current</span>
                <p className="font-mono">{fps} fps</p>
              </div>
              <div>
                <span className="text-slate-400">Average</span>
                <p className="font-mono">{summary.avgFps.toFixed(1)} fps</p>
              </div>
              <div>
                <span className="text-slate-400">Dropped Frames</span>
                <p className="font-mono">{fpsHistory.filter((f) => f.droppedFrame).length}</p>
              </div>
            </div>
            {detailed && fpsHistory.length > 1 && (
              <SparklineChart
                data={fpsHistory.map((f) => f.fps)}
                label="FPS"
                color="#34d399"
                max={60}
              />
            )}
          </div>
        </ExpandableSection>

        {/* Operations Section */}
        <ExpandableSection
          title="Operations"
          icon={<Clock className="w-4 h-4" />}
          expanded={expandedSections.operations}
          onToggle={() => toggleSection('operations')}
          badge={`${metrics.length}`}
        >
          <div className="space-y-3">
            {/* Category Filter */}
            <div className="flex gap-1 flex-wrap">
              {(['all', 'scan', 'render', 'memory', 'network', 'ui'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    selectedCategory === cat
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Metrics List */}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredMetrics.length === 0 ? (
                <p className="text-slate-400 text-sm">No operations recorded</p>
              ) : (
                filteredMetrics
                  .slice(-20)
                  .toReversed()
                  .map((metric) => <MetricRow key={metric.id} metric={metric} />)
              )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t border-slate-700">
              <div>
                <span className="text-slate-400">Total Operations</span>
                <p className="font-mono">{summary.totalOperations}</p>
              </div>
              <div>
                <span className="text-slate-400">Failed</span>
                <p className={`font-mono ${summary.failedOperations > 0 ? 'text-red-400' : ''}`}>
                  {summary.failedOperations}
                </p>
              </div>
            </div>
          </div>
        </ExpandableSection>

        {/* Alerts Section */}
        <ExpandableSection
          title="Alerts"
          icon={<AlertTriangle className="w-4 h-4" />}
          expanded={expandedSections.alerts}
          onToggle={() => toggleSection('alerts')}
          badge={alertCounts.total > 0 ? alertCounts.total : undefined}
          badgeColor={alertCounts.critical > 0 ? 'red' : 'yellow'}
        >
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="text-slate-400 text-sm">No alerts</p>
            ) : (
              alerts
                .slice(-10)
                .toReversed()
                .map((alert, index) => (
                  <AlertRow key={`${alert.timestamp}-${index}`} alert={alert} />
                ))
            )}
          </div>
        </ExpandableSection>
      </div>

      {/* Thresholds Footer */}
      {detailed && (
        <div className="bg-slate-800 px-4 py-2 text-xs text-slate-400">
          <div className="flex justify-between">
            <span>Thresholds:</span>
            <span>
              Scan: {formatDuration(activeThresholds.maxScanTime)} | Memory:{' '}
              {activeThresholds.maxMemoryMB}MB | FPS: {activeThresholds.minFps} | Render:{' '}
              {formatDuration(activeThresholds.maxRenderTime)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Sub-components
// ============================================

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  status: 'good' | 'warning' | 'critical';
  trend?: 'up' | 'down' | 'stable';
}

function SummaryCard({ icon, label, value, subValue, status, trend }: SummaryCardProps) {
  const statusColors = {
    good: 'text-green-400',
    warning: 'text-yellow-400',
    critical: 'text-red-400',
  };

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <div className="bg-slate-800 p-3">
      <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
        {icon}
        <span>{label}</span>
        {trend && (
          <TrendIcon
            className={`w-3 h-3 ${
              trend === 'up'
                ? 'text-red-400'
                : trend === 'down'
                  ? 'text-green-400'
                  : 'text-slate-500'
            }`}
          />
        )}
      </div>
      <p className={`text-lg font-semibold ${statusColors[status]}`}>{value}</p>
      {subValue && <p className="text-xs text-slate-500">{subValue}</p>}
    </div>
  );
}

interface ExpandableSectionProps {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: number | string;
  badgeColor?: 'yellow' | 'red';
}

function ExpandableSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
  badge,
  badgeColor = 'yellow',
}: ExpandableSectionProps) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium">{title}</span>
          {badge !== undefined && (
            <span
              className={`px-1.5 py-0.5 text-xs rounded ${
                badgeColor === 'red'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-yellow-500/20 text-yellow-400'
              }`}
            >
              {badge}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {expanded && <div className="px-4 py-3 bg-slate-800/30">{children}</div>}
    </div>
  );
}

interface MemoryBarProps {
  memory: MemorySnapshot;
  maxMemoryMB: number;
}

function MemoryBar({ memory, maxMemoryMB }: MemoryBarProps) {
  const usedMB = memory.usedJSHeapSize / (1024 * 1024);
  const percentage = (usedMB / maxMemoryMB) * 100;
  const isOverLimit = usedMB > maxMemoryMB;

  return (
    <div className="space-y-1">
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            isOverLimit ? 'bg-red-500' : percentage > 80 ? 'bg-yellow-500' : 'bg-blue-500'
          }`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>0 MB</span>
        <span>{maxMemoryMB} MB limit</span>
      </div>
    </div>
  );
}

interface FpsBarProps {
  fps: number;
  minFps: number;
}

function FpsBar({ fps, minFps }: FpsBarProps) {
  const percentage = (fps / 60) * 100;
  const isBelowTarget = fps < minFps;

  return (
    <div className="space-y-1">
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            isBelowTarget ? 'bg-red-500' : fps < 58 ? 'bg-yellow-500' : 'bg-green-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>0 fps</span>
        <span>60 fps target</span>
      </div>
    </div>
  );
}

interface MetricRowProps {
  metric: PerformanceMetric;
}

function MetricRow({ metric }: MetricRowProps) {
  const categoryColors: Record<PerformanceMetric['category'], string> = {
    scan: 'text-blue-400',
    render: 'text-purple-400',
    memory: 'text-orange-400',
    network: 'text-cyan-400',
    ui: 'text-green-400',
  };

  const statusIcon = metric.isRunning ? (
    <RefreshCw className="w-3 h-3 animate-spin text-yellow-400" />
  ) : metric.metadata?.error ? (
    <XCircle className="w-3 h-3 text-red-400" />
  ) : (
    <CheckCircle2 className="w-3 h-3 text-green-400" />
  );

  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded bg-slate-700/50 text-sm">
      {statusIcon}
      <span className={`font-medium ${categoryColors[metric.category]}`}>{metric.name}</span>
      <span className="text-slate-400 text-xs">{metric.category}</span>
      <span className="ml-auto font-mono text-xs">
        {metric.isRunning ? 'running...' : formatDuration(metric.duration)}
      </span>
    </div>
  );
}

interface AlertRowProps {
  alert: PerformanceAlert;
}

function AlertRow({ alert }: AlertRowProps) {
  const Icon = alert.type === 'critical' ? AlertCircle : AlertTriangle;
  const time = new Date(alert.timestamp).toLocaleTimeString();

  return (
    <div
      className={`flex items-start gap-2 py-2 px-2 rounded text-sm ${
        alert.type === 'critical' ? 'bg-red-500/10' : 'bg-yellow-500/10'
      }`}
    >
      <Icon
        className={`w-4 h-4 flex-shrink-0 ${
          alert.type === 'critical' ? 'text-red-400' : 'text-yellow-400'
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-white">{alert.message}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {time} | {alert.metric} | {alert.value.toFixed(1)} / {alert.threshold}
        </p>
      </div>
    </div>
  );
}

interface SparklineChartProps {
  data: number[];
  label: string;
  color: string;
  max?: number;
}

function SparklineChart({ data, label, color, max }: SparklineChartProps) {
  const maxValue = max ?? Math.max(...data, 1);
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * 100;
      const y = 100 - (value / maxValue) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="space-y-1">
      <span className="text-xs text-slate-400">{label}</span>
      <svg className="w-full h-12" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

// ============================================
// Helper functions
// ============================================

function getMemoryStatus(
  memory: MemorySnapshot | null,
  maxMemoryMB: number
): 'good' | 'warning' | 'critical' {
  if (!memory) return 'good';
  const usedMB = memory.usedJSHeapSize / (1024 * 1024);
  if (usedMB > maxMemoryMB) return 'critical';
  if (usedMB > maxMemoryMB * 0.8) return 'warning';
  return 'good';
}

function getFpsStatus(fps: number, minFps: number): 'good' | 'warning' | 'critical' {
  if (fps < minFps - 5) return 'critical';
  if (fps < minFps) return 'warning';
  return 'good';
}

function getScanStatus(avgScanTime: number, maxScanTime: number): 'good' | 'warning' | 'critical' {
  if (avgScanTime === 0) return 'good';
  if (avgScanTime > maxScanTime * 1.5) return 'critical';
  if (avgScanTime > maxScanTime) return 'warning';
  return 'good';
}

export default PerformanceDashboard;
