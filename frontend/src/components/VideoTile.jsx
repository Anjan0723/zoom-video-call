import React, { useEffect, useRef } from "react";

export default function VideoTile({ peerId, name, stream }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const hasValidStream = stream && stream.getTracks && stream.getTracks().length > 0;

    if (!hasValidStream) {
      videoElement.srcObject = null;
      return;
    }

    const attachVideo = () => {
      const videoTracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
      console.log(`🎥 VideoTile ${peerId}: Video tracks:`, videoTracks.length, 'Stream active:', stream.active);
      if (!videoTracks || videoTracks.length === 0) {
        videoElement.srcObject = null;
        return;
      }
      console.log(`🎥 VideoTile ${peerId}: Setting srcObject to stream`);
      videoElement.srcObject = stream;
      console.log(`🎥 VideoTile ${peerId}: Video element srcObject:`, videoElement.srcObject);
      console.log(`🎥 VideoTile ${peerId}: Video element readyState:`, videoElement.readyState);
      console.log(`🎥 VideoTile ${peerId}: Video element videoTracks:`, videoElement.videoTracks?.length || 0);
    };

    attachVideo();

    // Don't play immediately - wait for loadedmetadata
    let hasPlayed = false;
    const playVideo = () => {
      if (hasPlayed) return;
      hasPlayed = true;
      console.log(`🎥 VideoTile ${peerId}: Attempting to play video. readyState:`, videoElement.readyState);
      videoElement.play().then(() => {
        console.log(`🎥 VideoTile ${peerId}: Video play() succeeded`);
      }).catch(err => {
        console.error(`🎥 VideoTile ${peerId}: Video play() failed:`, err);
        // If autoplay fails, try again on next user interaction
        const playOnClick = () => {
          console.log(`🎥 VideoTile ${peerId}: Retrying play on click`);
          videoElement.play();
          document.removeEventListener('click', playOnClick);
        };
        document.addEventListener('click', playOnClick, { once: true });
      });
    };

    const handleLoadedMetadata = () => {
      console.log(`🎥 VideoTile ${peerId}: loadedmetadata fired, readyState:`, videoElement.readyState);
      playVideo();
    };

    // Play immediately if already loaded
    if (videoElement.readyState >= 2) {
      playVideo();
    } else {
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    }

    // Listen for new tracks
    const handleAddTrack = () => {
      attachVideo();
      playVideo();
    };

    stream.addEventListener('addtrack', handleAddTrack);

    // Cleanup
    return () => {
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      stream.removeEventListener('addtrack', handleAddTrack);
      if (videoElement.srcObject) {
        videoElement.srcObject = null;
      }
    };
  }, [stream, peerId]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) return;

    const hasValidStream = stream && stream.getTracks && stream.getTracks().length > 0;
    if (!hasValidStream || peerId === "local") {
      audioElement.srcObject = null;
      return;
    }

    const attachAudio = () => {
      const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
      if (!audioTracks || audioTracks.length === 0) {
        audioElement.srcObject = null;
        return;
      }
      const audioOnlyStream = new MediaStream(audioTracks);
      audioElement.srcObject = audioOnlyStream;
    };

    attachAudio();
    audioElement.play().catch(() => {
      const playOnClick = () => {
        audioElement.play();
        document.removeEventListener('click', playOnClick);
      };
      document.addEventListener('click', playOnClick, { once: true });
    });

    const handleAddTrack = () => {
      attachAudio();
      audioElement.play().catch(() => {});
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
        muted
        className="w-full h-full object-cover"
      />

      <audio ref={audioRef} autoPlay playsInline />

      {/* Loading State */}
      {(!hasValidStream || !hasVideo) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl font-bold text-white">
                {name?.[0]?.toUpperCase() || "?"}
              </span>
            </div>
            <div className="w-8 h-8 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin mx-auto mb-2"></div>
            <p className="text-gray-400 text-sm">Connecting...</p>
          </div>
        </div>
      )}

      {/* Name Label */}
      <div className="absolute bottom-3 left-3 px-3 py-1.5 text-sm bg-black/70 text-white rounded-lg font-medium shadow-lg">
        {name || "User"}
      </div>
    </div>
  );
}