'use client';

import { useState } from 'react';

const PLATFORMS = [
  { id: 'youtube', name: 'YouTube', icon: '📺', aspectRatio: '16:9' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', aspectRatio: '9:16' },
  { id: 'instagram_story', name: 'Instagram Story', icon: '📱', aspectRatio: '9:16' },
  { id: 'instagram_feed', name: 'Instagram Feed', icon: '📷', aspectRatio: '1:1' },
  { id: 'instagram_reel', name: 'Instagram Reel', icon: '🎬', aspectRatio: '9:16' },
  { id: 'facebook', name: 'Facebook', icon: '👥', aspectRatio: '16:9' },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', aspectRatio: '16:9' },
  { id: 'twitter', name: 'Twitter', icon: '🐦', aspectRatio: '16:9' },
];

export function PlatformSelector() {
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-xl font-semibold mb-4">Platform Presets</h3>
      <p className="text-sm text-gray-600 mb-4">
        Optimize your videos for different social media platforms with one click.
      </p>

      <div className="space-y-2">
        {PLATFORMS.map((platform) => (
          <button
            key={platform.id}
            onClick={() => setSelectedPlatform(platform.id)}
            className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
              selectedPlatform === platform.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{platform.icon}</span>
                <div>
                  <div className="font-medium text-gray-900">{platform.name}</div>
                  <div className="text-xs text-gray-500">{platform.aspectRatio}</div>
                </div>
              </div>
              {selectedPlatform === platform.id && (
                <span className="text-blue-600">✓</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {selectedPlatform && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            Selected: {PLATFORMS.find((p) => p.id === selectedPlatform)?.name}
          </p>
          <p className="text-xs text-blue-600 mt-1">
            Upload a video above and it will be optimized for this platform.
          </p>
        </div>
      )}
    </div>
  );
}
