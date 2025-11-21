import { GetServerSideProps } from 'next';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Database,
  Activity,
  Calendar,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Users,
  FileText
} from 'lucide-react';
import { api } from '@/services/api';
import { ImportStats, JobStats, SystemHealth } from '@/types';

interface DashboardProps {
  initialHealth: SystemHealth;
  initialImportStats: ImportStats;
  initialJobStats: JobStats;
}

export default function Dashboard({ initialHealth, initialImportStats, initialJobStats }: DashboardProps) {
  const [health, setHealth] = useState<SystemHealth>(initialHealth);
  const [importStats, setImportStats] = useState<ImportStats>(initialImportStats);
  const [jobStats, setJobStats] = useState<JobStats>(initialJobStats);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Refresh data every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      await refreshData();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const refreshData = async () => {
    try {
      setLoading(true);
      const [healthRes, importRes, jobRes] = await Promise.all([
        api.get('/health'),
        api.get('/api/imports/stats?days=30'),
        api.get('/api/jobs/stats?days=30')
      ]);

      setHealth(healthRes.data);
      setImportStats(importRes.data);
      setJobStats(jobRes.data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to refresh dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const isHealthy = health.status === 'healthy';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-4">
              <h1 className="text-3xl font-bold text-gray-900">Job Importer Dashboard</h1>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
                <span className={`text-sm font-medium ${isHealthy ? 'text-green-600' : 'text-red-600'}`}>
                  {isHealthy ? 'System Healthy' : 'System Issues'}
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </span>
              <button
                onClick={refreshData}
                disabled={loading}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Link href="/imports">
              <div className="bg-white p-6 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer border border-gray-200">
                <div className="flex items-center space-x-3">
                  <Activity className="h-8 w-8 text-primary-600" />
                  <div>
                    <h3 className="font-medium text-gray-900">Manage Imports</h3>
                    <p className="text-sm text-gray-500">Start and monitor imports</p>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/jobs">
              <div className="bg-white p-6 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer border border-gray-200">
                <div className="flex items-center space-x-3">
                  <FileText className="h-8 w-8 text-primary-600" />
                  <div>
                    <h3 className="font-medium text-gray-900">View Jobs</h3>
                    <p className="text-sm text-gray-500">Browse and search jobs</p>
                  </div>
                </div>
              </div>
            </Link>

            <Link href="/admin">
              <div className="bg-white p-6 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer border border-gray-200">
                <div className="flex items-center space-x-3">
                  <Database className="h-8 w-8 text-primary-600" />
                  <div>
                    <h3 className="font-medium text-gray-900">System Admin</h3>
                    <p className="text-sm text-gray-500">Configure sources and queues</p>
                  </div>
                </div>
              </div>
            </Link>

            <a href="/api" target="_blank" rel="noopener noreferrer">
              <div className="bg-white p-6 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer border border-gray-200">
                <div className="flex items-center space-x-3">
                  <FileText className="h-8 w-8 text-primary-600" />
                  <div>
                    <h3 className="font-medium text-gray-900">API Docs</h3>
                    <p className="text-sm text-gray-500">View API documentation</p>
                  </div>
                </div>
              </div>
            </a>
          </div>
        </div>

        {/* Statistics Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Import Statistics */}
          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Import Statistics</h3>
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Imports</span>
                <span className="text-lg font-medium text-gray-900">{importStats.overview?.totalImports || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Success Rate</span>
                <span className="text-lg font-medium text-green-600">
                  {importStats.overview?.totalImports > 0
                    ? Math.round((importStats.overview.successfulImports / importStats.overview.totalImports) * 100)
                    : 0}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Jobs Processed</span>
                <span className="text-lg font-medium text-gray-900">{importStats.overview?.totalJobsProcessed || 0}</span>
              </div>
            </div>
          </div>

          {/* Job Statistics */}
          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Job Statistics</h3>
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Jobs</span>
                <span className="text-lg font-medium text-gray-900">{jobStats.overview?.totalJobs || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Active Jobs</span>
                <span className="text-lg font-medium text-green-600">{jobStats.overview?.activeJobs || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Sources</span>
                <span className="text-lg font-medium text-gray-900">{jobStats.breakdown?.sources?.length || 0}</span>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">System Health</h3>
              {isHealthy ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600" />
              )}
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Database</span>
                <span className={`text-sm font-medium ${
                  health.services?.database?.healthy ? 'text-green-600' : 'text-red-600'
                }`}>
                  {health.services?.database?.healthy ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Redis</span>
                <span className={`text-sm font-medium ${
                  health.services?.redis?.healthy ? 'text-green-600' : 'text-red-600'
                }`}>
                  {health.services?.redis?.healthy ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Queues</span>
                <span className={`text-sm font-medium ${
                  health.services?.queues?.healthy ? 'text-green-600' : 'text-red-600'
                }`}>
                  {health.services?.queues?.healthy ? 'Healthy' : 'Issues'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Imports */}
          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Recent Imports</h3>
              <Link href="/imports" className="text-sm text-primary-600 hover:text-primary-800">
                View All
              </Link>
            </div>
            <div className="space-y-3">
              {importStats.recentImports?.length > 0 ? (
                importStats.recentImports.slice(0, 5).map((imp: any, index: number) => (
                  <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center space-x-3">
                      <div className={`w-2 h-2 rounded-full ${
                        imp.status === 'completed' ? 'bg-green-500' :
                        imp.status === 'failed' ? 'bg-red-500' :
                        imp.status === 'running' ? 'bg-blue-500' :
                        'bg-gray-500'
                      }`} />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{imp.source}</p>
                        <p className="text-xs text-gray-500">{new Date(imp.startedAt).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">{imp.totalJobs} jobs</p>
                      <p className="text-xs text-gray-500 capitalize">{imp.status}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No recent imports</p>
              )}
            </div>
          </div>

          {/* Running Imports */}
          <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Running Imports</h3>
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div className="space-y-3">
              {importStats.runningImports?.length > 0 ? (
                importStats.runningImports.map((imp: any, index: number) => (
                  <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center space-x-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{imp.source}</p>
                        <p className="text-xs text-gray-500">Started {new Date(imp.startedAt).toLocaleTimeString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">{imp.totalJobs} jobs</p>
                      <p className="text-xs text-blue-600">In Progress</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No running imports</p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  try {
    // Fetch initial data on server side
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    const [healthRes, importRes, jobRes] = await Promise.all([
      fetch(`${baseUrl}/health`).then(res => res.json()),
      fetch(`${baseUrl}/api/imports/stats?days=30`).then(res => res.json()).catch(() => ({ data: {} })),
      fetch(`${baseUrl}/api/jobs/stats?days=30`).then(res => res.json()).catch(() => ({ data: {} }))
    ]);

    return {
      props: {
        initialHealth: healthRes,
        initialImportStats: importRes.data || {},
        initialJobStats: jobRes.data || {}
      }
    };
  } catch (error) {
    console.error('Failed to fetch initial data:', error);

    return {
      props: {
        initialHealth: { status: 'error' },
        initialImportStats: {},
        initialJobStats: {}
      }
    };
  }
};