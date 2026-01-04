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

    const videoTracks = stream.getVideoTracks();
    console.log(`🎥 VideoTile ${peerId}: Video tracks:`, videoTracks.length, 'Stream active:', stream.active);
    
    if (videoTracks.length === 0) {
      videoElement.srcObject = null;
      return;
    }

    // Only update srcObject if it's different
    if (videoElement.srcObject !== stream) {
      videoElement.srcObject = stream;
      console.log(`🎥 VideoTile ${peerId}: Set srcObject`);
    }

    // Handle playing the video
    const playVideo = async () => {
      try {
        // Wait for video to be ready
        if (videoElement.readyState < 2) {
          await new Promise(resolve => {
            videoElement.addEventListener('loadedmetadata', resolve, { once: true });
          });
        }
        
        console.log(`🎥 VideoTile ${peerId}: Attempting to play video. readyState:`, videoElement.readyState);
        await videoElement.play();
        console.log(`🎥 VideoTile ${peerId}: Video play() succeeded`);
      } catch (err) {
        console.error(`🎥 VideoTile ${peerId}: Video play() failed:`, err);
        // Retry on user interaction
        const playOnInteraction = () => {
          console.log(`🎥 VideoTile ${peerId}: Retrying play on interaction`);
          videoElement.play().catch(console.error);
          document.removeEventListener('click', playOnInteraction);
          document.removeEventListener('touchstart', playOnInteraction);
        };
        document.addEventListener('click', playOnInteraction, { once: true });
        document.addEventListener('touchstart', playOnInteraction, { once: true });
      }
    };

    playVideo();

    // Listen for new tracks being added
    const handleAddTrack = (e) => {
      console.log(`🎥 VideoTile ${peerId}: New track added:`, e.track.kind);
      playVideo();
    };

    stream.addEventListener('addtrack', handleAddTrack);

    // Cleanup
    return () => {
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
        // Retry on user interaction
        const playOnInteraction = () => {
          audioElement.play().catch(console.error);
          document.removeEventListener('click', playOnInteraction);
          document.removeEventListener('touchstart', playOnInteraction);
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
      />

      {/* Audio Element (hidden, only for remote peers) */}
      {peerId !== "local" && (
        <audio ref={audioRef} autoPlay playsInline />
      )}

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
            <p className="text-gray-400 text-sm">Connecting video...</p>
          </div>
        </div>
      )}

      {/* Name Label */}
      <div className="absolute bottom-3 left-3 px-3 py-1.5 text-sm bg-black/70 text-white rounded-lg font-medium shadow-lg">
        {name || "User"} {peerId === "local" && "(You)"}
      </div>
    </div>
  );
}