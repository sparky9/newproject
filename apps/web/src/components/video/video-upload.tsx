'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient } from '@/lib/api';

interface VideoUploadProps {
  onJobCreated?: () => void;
}

export function VideoUpload({ onJobCreated }: VideoUploadProps) {
  const { getToken } = useAuth();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'transcribe' | 'caption' | 'optimize'>('transcribe');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const api = createApiClient(getToken);

      if (actionType !== 'transcribe') {
        throw new Error('Only transcription is available in this preview. Choose Transcribe to continue.');
      }

      await api.video.transcribe(url);

      setUrl('');
      onJobCreated?.();
    } catch (err) {
      console.error('Failed to submit video job', err);
      setError(err instanceof Error ? err.message : 'Failed to process video');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-xl font-semibold mb-4">Upload or Link Video</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="action-type" className="block text-sm font-medium text-gray-700 mb-2">
            Action
          </label>
          <select
            id="action-type"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as any)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="transcribe">Transcribe Media</option>
            <option value="caption">Add Captions</option>
            <option value="optimize">Optimize for Platform</option>
          </select>
        </div>

        <div>
          <label htmlFor="video-url" className="block text-sm font-medium text-gray-700 mb-2">
            Video URL
          </label>
          <input
            id="video-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/video.mp4"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-sm text-gray-500 mt-1">
            Provide a direct link to your video or audio file
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !url}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Processing...' : 'Start Processing'}
        </button>
      </form>

      <div className="mt-6 border-t pt-6">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Supported Formats</h4>
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
          <div>
            <span className="font-medium">Video:</span> MP4, MOV, AVI, WebM
          </div>
          <div>
            <span className="font-medium">Audio:</span> MP3, WAV, M4A, FLAC
          </div>
        </div>
      </div>
    </div>
  );
}
