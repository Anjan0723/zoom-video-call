import React, { useEffect, useRef, useState } from "react";

export default function VideoTile({ peerId, name, stream }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const videoEffectTokenRef = useRef(0);
  const audioEffectTokenRef = useRef(0);
  const videoPlayPromiseRef = useRef(null);
  const audioPlayPromiseRef = useRef(null);
  const [videoState, setVideoState] = useState({
    hasStream: false,
    hasVideoTrack: false,
    isPlaying: false,
    readyState: 0,
    error: null
  });

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    videoEffectTokenRef.current += 1;
    const token = videoEffectTokenRef.current;

    const hasValidStream = stream && stream.getTracks && stream.getTracks().length > 0;

    if (!hasValidStream) {
      videoElement.srcObject = null;
      setVideoState({
        hasStream: false,
        hasVideoTrack: false,
        isPlaying: false,
        readyState: 0,
        error: 'No valid stream'
      });
      return;
    }

    const videoTracks = stream.getVideoTracks();
    console.log(`🎥 VideoTile ${peerId}: Video tracks:`, videoTracks.length, 'Stream active:', stream.active);
    console.log(`🎥 VideoTile ${peerId}: Stream ID:`, stream.id);
    console.log(`🎥 VideoTile ${peerId}: Video track details:`, videoTracks.map(t => ({
      id: t.id,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
      label: t.label
    })));
    
    // Always attach the stream even if video track is not present yet.
    // mediasoup often delivers audio first, then video arrives later via addtrack.
    setVideoState(prev => ({
      ...prev,
      hasStream: true,
      hasVideoTrack: videoTracks.length > 0,
      isPlaying: false,
      readyState: 0,
      error: videoTracks.length === 0 ? 'No video tracks' : null
    }));

    // Check if video track is actually active
    const activeVideoTrack = videoTracks.find(t => t.readyState === 'live' && t.enabled);
    if (!activeVideoTrack) {
      console.warn(`⚠️ VideoTile ${peerId}: No active video tracks found`);
      setVideoState({
        hasStream: true,
        hasVideoTrack: true,
        isPlaying: false,
        readyState: 0,
        error: 'Video track not live'
      });
    }

    // Only update srcObject if it's different
    if (videoElement.srcObject !== stream) {
      console.log(`🎥 VideoTile ${peerId}: Setting srcObject to stream`, stream.id);
      videoElement.srcObject = stream;
    }

    // Handle playing the video
    let cancelled = false;
    const playVideo = async () => {
      try {
        if (cancelled) return;
        console.log(`🎥 VideoTile ${peerId}: Attempting to play video.`);
        if (videoPlayPromiseRef.current) {
          await videoPlayPromiseRef.current;
          return;
        }
        videoPlayPromiseRef.current = videoElement.play();
        await videoPlayPromiseRef.current;
        if (cancelled) return;
        console.log(`✅ VideoTile ${peerId}: Video play() succeeded`);
        setVideoState(prev => ({
          ...prev,
          hasStream: true,
          hasVideoTrack: true,
          isPlaying: true,
          readyState: videoElement.readyState,
          error: null
        }));
      } catch (err) {
        if (cancelled) return;
        if (err?.name === 'AbortError') {
          // Usually caused by React StrictMode effect remount or rapid srcObject updates.
          // Safe to ignore; a subsequent play() will succeed.
          return;
        }
        console.error(`❌ VideoTile ${peerId}: Video play() failed:`, err);
        setVideoState(prev => ({
          ...prev,
          hasStream: true,
          hasVideoTrack: true,
          isPlaying: false,
          readyState: videoElement.readyState,
          error: err?.message || 'Video play failed'
        }));
      } finally {
        videoPlayPromiseRef.current = null;
      }
    };

    if (videoTracks.length > 0) {
      playVideo();
    }

    // Listen for track state changes
    videoTracks.forEach(track => {
      track.addEventListener('ended', () => {
        console.log(`🎥 VideoTile ${peerId}: Video track ended`);
        setVideoState(prev => ({ ...prev, isPlaying: false, error: 'Track ended' }));
      });
      track.addEventListener('mute', () => {
        console.log(`🎥 VideoTile ${peerId}: Video track muted`);
      });
      track.addEventListener('unmute', () => {
        console.log(`🎥 VideoTile ${peerId}: Video track unmuted`);
        // Try to play again when track is unmuted
        videoElement.play().then(() => {
          setVideoState(prev => ({ ...prev, isPlaying: true, readyState: videoElement.readyState, error: null }));
        }).catch(console.error);
      });
    });

    // Listen for new tracks being added
    const handleAddTrack = (e) => {
      console.log(`🎥 VideoTile ${peerId}: New track added:`, e.track.kind, e.track.id);
      if (e.track.kind === 'video') {
        setVideoState(prev => ({
          ...prev,
          hasStream: true,
          hasVideoTrack: true,
          error: null
        }));
        playVideo();
      }
    };

    stream.addEventListener('addtrack', handleAddTrack);

    // Cleanup
    return () => {
      cancelled = true;
      videoPlayPromiseRef.current = null;
      stream.removeEventListener('addtrack', handleAddTrack);
      // React StrictMode mounts/unmounts effects twice in dev.
      // Only clear if this cleanup belongs to the latest effect.
      if (videoEffectTokenRef.current === token && videoElement.srcObject === stream) {
        videoElement.srcObject = null;
      }
    };
  }, [stream, peerId]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    audioEffectTokenRef.current += 1;
    const token = audioEffectTokenRef.current;

    const hasValidStream = stream && stream.getTracks && stream.getTracks().length > 0;
    
    // Don't play local audio (causes echo)
    if (!hasValidStream || peerId === "local") {
      audioElement.srcObject = null;
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      audioElement.srcObject = null;
      return;
    }

    // Attach the full stream to audio element to avoid creating a new MediaStream
    // on each render (which interrupts playback).
    if (audioElement.srcObject !== stream) {
      audioElement.srcObject = stream;
      console.log(`🔊 VideoTile ${peerId}: Set audio srcObject`);
    }

    // Play audio
    const playAudio = async () => {
      try {
        if (audioPlayPromiseRef.current) {
          await audioPlayPromiseRef.current;
          return;
        }
        audioPlayPromiseRef.current = audioElement.play();
        await audioPlayPromiseRef.current;
        console.log(`🔊 VideoTile ${peerId}: Audio play() succeeded`);
      } catch (err) {
        if (err?.name === 'AbortError') {
          return;
        }
        console.error(`🔊 VideoTile ${peerId}: Audio play() failed:`, err);
        const playOnInteraction = () => {
          audioElement.play().catch(console.error);
        };
        document.addEventListener('click', playOnInteraction, { once: true });
        document.addEventListener('touchstart', playOnInteraction, { once: true });
      } finally {
        audioPlayPromiseRef.current = null;
      }
    };

    playAudio();

    return () => {
      audioPlayPromiseRef.current = null;
      if (audioEffectTokenRef.current === token && audioElement.srcObject === stream) {
        audioElement.srcObject = null;
      }
    };
  }, [stream, peerId]);

  const hasValidStream = stream && stream.getTracks && stream.getTracks().length > 0;
  const hasVideo = hasValidStream && stream.getVideoTracks().length > 0;

  return (
    <div className="relative rounded-xl overflow-hidden bg-gray-800 aspect-video">
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        style={{ backgroundColor: '#1f2937' }}
      />

      {/* Audio Element (hidden, only for remote peers) */}
      {peerId !== "local" && (
        <audio ref={audioRef} autoPlay playsInline />
      )}

      {/* Loading/Error State */}
      {(!hasValidStream || !hasVideo) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <div className="text-center max-w-xs px-4">
            <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl font-bold text-white">
                {name?.[0]?.toUpperCase() || "?"}
              </span>
            </div>
            <p className="text-gray-400 text-sm">
              {!hasValidStream ? 'Waiting for stream...' : 'Camera is off'}
            </p>
          </div>
        </div>
      )}

      {/* Name Label */}
      <div className="absolute bottom-3 left-3 px-3 py-1.5 text-sm bg-black/70 text-white rounded-lg font-medium shadow-lg">
        {name || "User"} {peerId === "local" && "(You)"}
      </div>

      {/* Debug Info (remove in production) */}
      <div className="absolute top-3 right-3 px-2 py-1 text-xs bg-black/70 text-white rounded font-mono">
        {videoState.hasVideoTrack ? '📹' : '❌'} 
        {videoState.isPlaying ? ' ▶️' : ' ⏸️'}
        {` RS:${videoState.readyState}`}
      </div>
    </div>
  );
}