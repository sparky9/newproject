'use client';

import { useState } from 'react';
import { VideoUpload } from '@/components/video/video-upload';
import { JobList } from '@/components/video/job-list';
import { PlatformSelector } from '@/components/video/platform-selector';

export default function VideoProductionPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleJobCreated = () => {
    // Refresh the job list when a new job is created
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Video Production</h1>
        <p className="text-gray-600">
          Transform your content with AI-powered video tools. Transcribe media, extract viral
          clips, add captions, and optimize for any platform.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Section */}
        <div className="lg:col-span-2">
          <VideoUpload onJobCreated={handleJobCreated} />
        </div>

        {/* Platform Optimizer Quick Actions */}
        <div>
          <PlatformSelector />
        </div>
      </div>

      {/* Job History */}
      <div>
        <h2 className="text-2xl font-semibold mb-4">Processing Queue</h2>
        <JobList key={refreshKey} />
      </div>
    </div>
  );
}
