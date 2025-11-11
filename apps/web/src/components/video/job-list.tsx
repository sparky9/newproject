'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type { VideoJob } from '@ocsuite/types';
import { createApiClient } from '@/lib/api';

export function JobList() {
  const { getToken } = useAuth();
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const api = createApiClient(getToken);
      const data = await api.video.listJobs();
      setJobs(data.jobs);
      setError(null);
    } catch (err) {
      console.error('Failed to load video jobs', err);
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadJobs();
    // Poll for updates every 5 seconds
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleDelete = useCallback(
    async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this job?')) {
      return;
    }

    try {
        const api = createApiClient(getToken);
        await api.video.deleteJob(jobId);
        await loadJobs();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete job';
        alert(`Failed to delete job: ${message}`);
      }
    },
    [getToken, loadJobs]
  );

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-500">Loading jobs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        {error}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-500">No jobs yet. Start by uploading a video above.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Progress
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Output
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {jobs.map((job) => (
            <tr key={job.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {job.type}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    job.status === 'completed'
                      ? 'bg-green-100 text-green-800'
                      : job.status === 'failed'
                      ? 'bg-red-100 text-red-800'
                      : job.status === 'processing'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {job.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div className="flex items-center">
                  <div className="w-full bg-gray-200 rounded-full h-2 mr-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <span className="text-xs">{job.progress}%</span>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-gray-500">
                {job.error && (
                  <span className="text-red-600" title={job.error}>
                    Error
                  </span>
                )}
                {job.outputUrls && job.outputUrls.length > 0 && (
                  <a
                    href={job.outputUrls[0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Download
                  </a>
                )}
                {job.transcriptId && !job.outputUrls && (
                  <span className="text-green-600">Transcript ready</span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button
                  onClick={() => handleDelete(job.id)}
                  className="text-red-600 hover:text-red-900"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
