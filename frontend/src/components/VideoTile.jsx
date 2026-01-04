import React, { useEffect, useRef, useState } from "react";

export default function VideoTile({ peerId, name, stream }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
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
    console.log(`🎥 VideoTile ${peerId}: Video track details:`, videoTracks.map(t => ({
      id: t.id,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
      label: t.label
    })));
    
    if (videoTracks.length === 0) {
      videoElement.srcObject = null;
      setVideoState({
        hasStream: true,
        hasVideoTrack: false,
        isPlaying: false,
        readyState: 0,
        error: 'No video tracks'
      });
      return;
    }

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
      videoElement.srcObject = stream;
      console.log(`🎥 VideoTile ${peerId}: Set srcObject`);
    }

    // Monitor ready state changes
    const updateReadyState = () => {
      setVideoState(prev => ({
        ...prev,
        readyState: videoElement.readyState
      }));
      console.log(`🎥 VideoTile ${peerId}: ReadyState changed to:`, videoElement.readyState);
    };

    videoElement.addEventListener('loadedmetadata', updateReadyState);
    videoElement.addEventListener('loadeddata', updateReadyState);
    videoElement.addEventListener('canplay', updateReadyState);
    videoElement.addEventListener('canplaythrough', updateReadyState);

    // Handle playing the video
    const playVideo = async () => {
      try {
        // Wait for video to be ready
        if (videoElement.readyState < 2) {
          console.log(`🎥 VideoTile ${peerId}: Waiting for loadedmetadata...`);
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Metadata load timeout')), 5000);
            videoElement.addEventListener('loadedmetadata', () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
        }
        
        console.log(`🎥 VideoTile ${peerId}: Attempting to play video. readyState:`, videoElement.readyState);
        await videoElement.play();
        console.log(`✅ VideoTile ${peerId}: Video play() succeeded`);
        setVideoState(prev => ({
          ...prev,
          hasStream: true,
          hasVideoTrack: true,
          isPlaying: true,
          error: null
        }));
      } catch (err) {
        console.error(`❌ VideoTile ${peerId}: Video play() failed:`, err);
        setVideoState(prev => ({
          ...prev,
          error: err.message
        }));
        
        // Retry on user interaction
        const playOnInteraction = () => {
          console.log(`🔄 VideoTile ${peerId}: Retrying play on interaction`);
          videoElement.play()
            .then(() => {
              setVideoState(prev => ({ ...prev, isPlaying: true, error: null }));
            })
            .catch(console.error);
        };
        document.addEventListener('click', playOnInteraction, { once: true });
        document.addEventListener('touchstart', playOnInteraction, { once: true });
      }
    };

    playVideo();

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
      });
    });

    // Listen for new tracks being added
    const handleAddTrack = (e) => {
      console.log(`🎥 VideoTile ${peerId}: New track added:`, e.track.kind, e.track.id);
      if (e.track.kind === 'video') {
        playVideo();
      }
    };

    stream.addEventListener('addtrack', handleAddTrack);

    // Cleanup
    return () => {
      videoElement.removeEventListener('loadedmetadata', updateReadyState);
      videoElement.removeEventListener('loadeddata', updateReadyState);
      videoElement.removeEventListener('canplay', updateReadyState);
      videoElement.removeEventListener('canplaythrough', updateReadyState);
      stream.removeEventListener('addtrack', handleAddTrack);
      if (videoElement.srcObject === stream) {
        videoElement.srcObject = null;
      }
    };
  }, [stream, peerId]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

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

    // Create audio-only stream
    const audioOnlyStream = new MediaStream(audioTracks);
    
    if (audioElement.srcObject !== audioOnlyStream) {
      audioElement.srcObject = audioOnlyStream;
      console.log(`🔊 VideoTile ${peerId}: Set audio srcObject`);
    }

    // Play audio
    const playAudio = async () => {
      try {
        await audioElement.play();
        console.log(`🔊 VideoTile ${peerId}: Audio play() succeeded`);
      } catch (err) {
        console.error(`🔊 VideoTile ${peerId}: Audio play() failed:`, err);
        const playOnInteraction = () => {
          audioElement.play().catch(console.error);
        };
        document.addEventListener('click', playOnInteraction, { once: true });
        document.addEventListener('touchstart', playOnInteraction, { once: true });
      }
    };

    playAudio();

    // Listen for new audio tracks
    const handleAddTrack = (e) => {
      if (e.track.kind === 'audio') {
        console.log(`🔊 VideoTile ${peerId}: New audio track added`);
        const newAudioStream = new MediaStream([e.track]);
        audioElement.srcObject = newAudioStream;
        playAudio();
      }
    };

    stream.addEventListener('addtrack', handleAddTrack);

    return () => {
      stream.removeEventListener('addtrack', handleAddTrack);
      audioElement.srcObject = null;
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
        muted={peerId === "local"}
        className="w-full h-full object-cover"
        style={{ backgroundColor: '#1f2937' }}
      />

      {/* Audio Element (hidden, only for remote peers) */}
      {peerId !== "local" && (
        <audio ref={audioRef} autoPlay playsInline />
      )}

      {/* Loading/Error State */}
      {(!hasValidStream || !hasVideo || !videoState.isPlaying) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <div className="text-center max-w-xs px-4">
            <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl font-bold text-white">
                {name?.[0]?.toUpperCase() || "?"}
              </span>
            </div>
            {videoState.error ? (
              <>
                <p className="text-red-400 text-sm mb-2">⚠️ {videoState.error}</p>
                <p className="text-gray-500 text-xs">Click anywhere to retry</p>
              </>
            ) : (
              <>
                <div className="w-8 h-8 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin mx-auto mb-2"></div>
                <p className="text-gray-400 text-sm">
                  {!hasValidStream ? 'Waiting for stream...' : 
                   !hasVideo ? 'Waiting for video track...' : 
                   `Loading video... (${videoState.readyState}/4)`}
                </p>
              </>
            )}
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