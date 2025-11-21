// Common types used across the frontend application

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginationResponse<T> {
  items: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: any;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

// Job related types
export interface Job {
  id: string;
  externalId: string;
  source: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salary?: string;
  jobType: 'full-time' | 'part-time' | 'contract' | 'temporary' | 'internship' | 'remote';
  category?: string;
  requirements?: string[];
  applicationUrl?: string;
  postedAt: string;
  expiresAt?: string;
  isActive: boolean;
  daysSincePosted?: number;
  importedAt: string;
  metadata?: Record<string, any>;
}

export interface JobFilters {
  source?: string;
  category?: string;
  jobType?: string;
  location?: string;
  company?: string;
  search?: string;
  activeOnly?: boolean;
  minSalary?: number;
  maxSalary?: number;
  startDate?: string;
  endDate?: string;
}

export interface JobStats {
  overview: {
    totalJobs: number;
    activeJobs: number;
    inactiveJobs: number;
  };
  breakdown: {
    sources: Array<{
      _id: string;
      totalJobs: number;
      activeJobs: number;
      avgSalaryMin?: number;
      avgSalaryMax?: number;
    }>;
    categories: Array<{
      _id: string;
      count: number;
      avgSalaryMin?: number;
    }>;
    jobTypes: Array<{
      _id: string;
      count: number;
    }>;
    locations: Array<{
      _id: string;
      count: number;
    }>;
  };
  salary: {
    avgSalaryMin: number;
    avgSalaryMax: number;
    minSalary: number;
    maxSalary: number;
    count: number;
  };
  trends: Array<{
    _id: {
      year: number;
      month: number;
      day: number;
    };
    count: number;
  }>;
}

// Import related types
export interface ImportHistory {
  id: string;
  source: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  durationFormatted?: string;
  totalJobs: number;
  newJobs: number;
  updatedJobs: number;
  duplicateJobs: number;
  failedJobs: number;
  successRate: string;
  failureRate: string;
  errorCount: number;
  configuration: {
    batchSize: number;
    concurrency: number;
    filters?: Record<string, any>;
    retryAttempts?: number;
  };
  triggeredBy: 'manual' | 'scheduled' | 'api';
  processingStats?: {
    jobsPerSecond?: string;
    averageProcessingTime?: number;
    batchCount?: number;
  };
  isRunning: boolean;
}

export interface ImportStats {
  overview: {
    totalImports: number;
    successfulImports: number;
    failedImports: number;
    totalJobsProcessed: number;
    totalNewJobs: number;
    totalUpdatedJobs: number;
    totalFailedJobs: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
  };
  sourceBreakdown: Array<{
    _id: string;
    totalImports: number;
    successfulImports: number;
    totalJobs: number;
    averageDuration: number;
  }>;
  recentImports: ImportHistory[];
  runningImports: ImportHistory[];
}

export interface ImportError {
  jobId?: string;
  externalId?: string;
  error: {
    message: string;
    stack?: string;
  };
  timestamp: string;
  context?: Record<string, any>;
}

// Job Source related types
export interface JobSource {
  id: string;
  name: string;
  url: string;
  format: 'xml' | 'json' | 'rss';
  isActive: boolean;
  lastImportAt?: string;
  nextScheduledImport?: string;
  isOverdueForImport: boolean;
  totalImports: number;
  totalJobsImported: number;
  averageJobsPerImport: number;
  settings: {
    fetchInterval: number;
    batchSize: number;
    concurrency: number;
    timeout: number;
    retryAttempts: number;
  };
  isHealthy: boolean;
  health: {
    lastSuccessfulConnection?: string;
    lastFailure?: string;
    consecutiveFailures: number;
    averageResponseTime?: number;
    lastError?: {
      message: string;
      code: string;
      timestamp: string;
    };
  };
}

export interface JobSourceConfig {
  name: string;
  url: string;
  apiKey?: string;
  format: 'xml' | 'json' | 'rss';
  isActive?: boolean;
  settings?: {
    fetchInterval?: number;
    batchSize?: number;
    concurrency?: number;
    timeout?: number;
    retryAttempts?: number;
  };
  fieldMapping?: {
    id?: string;
    title?: string;
    company?: string;
    location?: string;
    description?: string;
    salary?: string;
    jobType?: string;
    category?: string;
    requirements?: string;
    applicationUrl?: string;
    postedAt?: string;
    expiresAt?: string;
  };
  auth?: {
    type: 'none' | 'bearer' | 'basic' | 'apikey';
    token?: string;
    username?: string;
    password?: string;
    apiKeyHeader?: string;
  };
}

// System health related types
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: {
      status: string;
      healthy: boolean;
    };
    redis: {
      status: string;
      healthy: boolean;
    };
    queues: {
      healthy: boolean;
      redisConnected: boolean;
      workerRunning: boolean;
      concurrency: number;
      timestamp: string;
    };
  };
}

export interface QueueStatus {
  name: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  };
  config: {
    name: string;
    defaultJobOptions: any;
  };
  recentJobs: {
    active: any[];
    completed: any[];
    failed: any[];
  };
  timestamp: string;
}

export interface QueueHealth {
  healthy: boolean;
  redisConnected: boolean;
  queueCount: number;
  workerCount: number;
  queues: Record<string, QueueStatus>;
  timestamp: string;
}

// Scheduler related types
export interface SchedulerStatus {
  isRunning: boolean;
  totalSchedulers: number;
  sourceSchedulers: Array<{
    name: string;
    sourceId: string;
    running: boolean;
  }>;
  globalSchedulers: Array<{
    name: string;
    running: boolean;
  }>;
  defaultCronPattern: string;
  timestamp: string;
}

export interface NextScheduledRun {
  sourceId: string;
  sourceName: string;
  nextScheduledImport: string;
  isOverdue: boolean;
  fetchInterval: number;
}

// Error analysis types
export interface ErrorAnalysis {
  source: string;
  errorType: string;
  count: number;
  occurrences: Array<{
    timestamp: string;
    externalId?: string;
  }>;
}

// Form and validation types
export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'number' | 'select' | 'textarea' | 'checkbox' | 'radio';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    custom?: (value: any) => string | undefined;
  };
}

export interface FormState {
  values: Record<string, any>;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isSubmitting: boolean;
  isValid: boolean;
}

// UI state types
export type SortDirection = 'asc' | 'desc' | null;
export type FilterOperator = 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan';

export interface TableColumn<T = any> {
  key: keyof T;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  render?: (value: any, item: T) => React.ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

export interface TableState<T = any> {
  data: T[];
  columns: TableColumn<T>[];
  loading: boolean;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  sort: {
    key: keyof T | null;
    direction: SortDirection;
  };
  filters: Record<keyof T, any>;
  selection: {
    selectedItems: T[];
    selectedIds: string[];
  };
}

// Notification types
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  timestamp: string;
}

// User and auth types
export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastLogin?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

// Configuration types
export interface AppConfig {
  apiBaseUrl: string;
  enablePolling: boolean;
  pollingInterval: number;
  enableNotifications: boolean;
  theme: 'light' | 'dark';
  language: string;
}

export interface ImportJobOptions {
  batchSize?: number;
  concurrency?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  filters?: Record<string, any>;
}

export interface BulkUpdateOptions {
  jobIds: string[];
  updateData: {
    isActive?: boolean;
    category?: string;
    jobType?: string;
  };
}