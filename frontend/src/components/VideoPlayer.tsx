import React, { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface VideoPlayerProps {
  recordingId: string;
}

export default function VideoPlayer({ recordingId }: VideoPlayerProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function fetchUrl() {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/recordings/${recordingId}/assets/video`);
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setVideoUrl(data.url);
      } catch (e) {
        console.warn('Failed to fetch video url', e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchUrl();
    return () => { mounted = false; };
  }, [recordingId]);

  if (loading) return <div>Loading video...</div>;
  if (!videoUrl) return <div>No video available for this recording.</div>;

  return (
    <div style={{ maxWidth: 900 }}>
      <video controls style={{ width: '100%' }} src={videoUrl} />
    </div>
  );
}
