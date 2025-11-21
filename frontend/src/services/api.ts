import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

// API Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Types
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
  recentImports: Array<{
    source: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    totalJobs: number;
    newJobs: number;
    updatedJobs: number;
    failedJobs: number;
  }>;
  runningImports: Array<{
    source: string;
    startedAt: string;
    totalJobs: number;
    configuration: any;
  }>;
}

export interface JobStats {
  overview: {
    totalJobs: number;
    activeJobs: number;
    inactiveJobs: number;
  };
  breakdown: {
    sources: Array<any>;
    categories: Array<any>;
    jobTypes: Array<any>;
    locations: Array<any>;
  };
  salary: {
    avgSalaryMin: number;
    avgSalaryMax: number;
    minSalary: number;
    maxSalary: number;
    count: number;
  };
  trends: Array<any>;
}

class ApiService {
  private client: AxiosInstance;
  private retryConfig = {
    retries: 3,
    retryDelay: 1000,
    retryCondition: (error: any) => {
      return !error.response || error.response.status >= 500;
    }
  };

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add auth token if available
        if (typeof window !== 'undefined') {
          const token = localStorage.getItem('authToken');
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        }

        // Add timestamp for debugging
        config.metadata = { startTime: new Date() };
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        // Log successful responses in development
        if (process.env.NODE_ENV === 'development') {
          const duration = new Date().getTime() - response.config.metadata?.startTime?.getTime();
          console.log(`API Success: ${response.config.method?.toUpperCase()} ${response.config.url} (${duration}ms)`);
        }
        return response;
      },
      (error) => {
        // Log error responses
        if (process.env.NODE_ENV === 'development') {
          const duration = error.config?.metadata?.startTime ?
            new Date().getTime() - error.config.metadata.startTime.getTime() : 0;
          console.error(`API Error: ${error.config?.method?.toUpperCase()} ${error.config?.url} (${duration}ms)`, error);
        }

        // Handle specific error cases
        if (error.response?.status === 401) {
          // Unauthorized - clear auth token and redirect to login
          if (typeof window !== 'undefined') {
            localStorage.removeItem('authToken');
            // You could trigger a redirect here if needed
          }
        }

        return Promise.reject(this.formatApiError(error));
      }
    );
  }

  private formatApiError(error: any): never {
    const formattedError: any = new Error(
      error.response?.data?.error || error.message || 'An unexpected error occurred'
    );

    formattedError.code = error.response?.data?.code || 'UNKNOWN_ERROR';
    formattedError.status = error.response?.status || 0;
    formattedError.details = error.response?.data?.details || null;
    formattedError.originalError = error;

    // Handle rate limiting
    if (error.response?.status === 429) {
      formattedError.message = 'Rate limit exceeded. Please try again later.';
      formattedError.code = 'RATE_LIMIT_EXCEEDED';
    }

    // Handle network errors
    if (!error.response) {
      formattedError.message = 'Network error. Please check your connection.';
      formattedError.code = 'NETWORK_ERROR';
    }

    throw formattedError;
  }

  // Generic request method with retry logic
  private async request<T = any>(
    config: AxiosRequestConfig,
    shouldRetry: boolean = true
  ): Promise<ApiResponse<T>> {
    let lastError: any;

    for (let attempt = 0; attempt <= (shouldRetry ? this.retryConfig.retries : 0); attempt++) {
      try {
        const response: AxiosResponse<ApiResponse<T>> = await this.client.request(config);
        return response.data;
      } catch (error) {
        lastError = error;

        // Don't retry on client errors (4xx) or if retry is disabled
        if (!shouldRetry ||
            attempt === this.retryConfig.retries ||
            !this.retryConfig.retryCondition(error)) {
          break;
        }

        // Wait before retrying
        await new Promise(resolve =>
          setTimeout(resolve, this.retryConfig.retryDelay * Math.pow(2, attempt))
        );
      }
    }

    throw lastError;
  }

  // HTTP Methods
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'PATCH', url, data });
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>({ ...config, method: 'DELETE', url });
  }

  // Specific API methods

  // Health check
  async getHealth(): Promise<SystemHealth> {
    const response = await this.get<SystemHealth>('/health');
    return response.data!;
  }

  // Import endpoints
  async startImport(sourceId: string, options: any = {}) {
    return this.post('/api/imports/start', { sourceId, options });
  }

  async getImports(params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`/api/imports${queryString ? `?${queryString}` : ''}`);
  }

  async getImport(id: string) {
    return this.get(`/api/imports/${id}`);
  }

  async cancelImport(id: string) {
    return this.post(`/api/imports/${id}/cancel`);
  }

  async retryImport(id: string) {
    return this.post(`/api/imports/${id}/retry`);
  }

  async getImportErrors(id: string, params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`/api/imports/${id}/errors${queryString ? `?${queryString}` : ''}`);
  }

  async getImportStats(params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`/api/imports/stats${queryString ? `?${queryString}` : ''}`);
  }

  async getRunningImports() {
    return this.get('/api/imports/running');
  }

  async cleanupImports(params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.delete(`/api/imports/cleanup${queryString ? `?${queryString}` : ''}`);
  }

  // Job endpoints
  async getJobs(params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`/api/jobs${queryString ? `?${queryString}` : ''}`);
  }

  async getJob(id: string) {
    return this.get(`/api/jobs/${id}`);
  }

  async updateJob(id: string, data: any) {
    return this.put(`/api/jobs/${id}`, data);
  }

  async deleteJob(id: string) {
    return this.delete(`/api/jobs/${id}`);
  }

  async getJobStats(params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`/api/jobs/stats${queryString ? `?${queryString}` : ''}`);
  }

  async bulkUpdateJobs(data: any) {
    return this.post('/api/jobs/bulk-update', data);
  }

  async searchJobs(query: string, filters: any = {}) {
    return this.post('/api/jobs/search', { q: query, filters });
  }

  // Admin endpoints
  async getSystemOverview() {
    return this.get('/api/admin/overview');
  }

  async getErrorAnalysis(params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`/api/admin/error-analysis${queryString ? `?${queryString}` : ''}`);
  }

  // Job Source Management
  async getJobSources(params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.get(`/api/admin/job-sources${queryString ? `?${queryString}` : ''}`);
  }

  async createJobSource(data: any) {
    return this.post('/api/admin/job-sources', data);
  }

  async updateJobSource(id: string, data: any) {
    return this.put(`/api/admin/job-sources/${id}`, data);
  }

  async deleteJobSource(id: string) {
    return this.delete(`/api/admin/job-sources/${id}`);
  }

  async testJobSource(id: string) {
    return this.post(`/api/admin/job-sources/${id}/test`);
  }

  // Queue Management
  async getQueueStatus(queueName?: string) {
    const queryString = queueName ? `?queueName=${queueName}` : '';
    return this.get(`/api/admin/queue/status${queryString}`);
  }

  async pauseQueue(queueName: string) {
    return this.post(`/api/admin/queue/${queueName}/pause`);
  }

  async resumeQueue(queueName: string) {
    return this.post(`/api/admin/queue/${queueName}/resume`);
  }

  async clearQueue(queueName: string, params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.delete(`/api/admin/queue/${queueName}/clear${queryString ? `?${queryString}` : ''}`);
  }

  // Scheduler Management
  async getSchedulerStatus() {
    return this.get('/api/admin/scheduler/status');
  }

  async startScheduler() {
    return this.post('/api/admin/scheduler/start');
  }

  async stopScheduler() {
    return this.post('/api/admin/scheduler/stop');
  }

  // System Maintenance
  async cleanupSystem(params: any = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.post(`/api/admin/cleanup${queryString ? `?${queryString}` : ''}`);
  }

  // Utility methods
  setAuthToken(token: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('authToken', token);
    }
    this.client.defaults.headers.Authorization = `Bearer ${token}`;
  }

  clearAuthToken() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('authToken');
    }
    delete this.client.defaults.headers.Authorization;
  }

  getAuthToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('authToken');
    }
    return null;
  }

  // Download files (CSV export, etc.)
  async downloadFile(url: string, filename?: string): Promise<void> {
    try {
      const response = await this.client.get(url, {
        responseType: 'blob',
      });

      // Create download link
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      this.formatApiError(error);
    }
  }

  // Upload files
  async uploadFile(url: string, file: File, additionalData: any = {}): Promise<ApiResponse> {
    const formData = new FormData();
    formData.append('file', file);

    // Add additional data
    Object.keys(additionalData).forEach(key => {
      formData.append(key, additionalData[key]);
    });

    return this.request({
      method: 'POST',
      url,
      data: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  }
}

// Create and export singleton instance
const api = new ApiService();
export default api;