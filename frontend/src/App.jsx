import React, { useState, useEffect, useRef } from "react";
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  PhoneOff, 
  Users, 
  Copy, 
  Check, 
  MessageSquare 
} from "lucide-react";

import VideoTile from "./components/VideoTile";
import ChatPanel from "./components/ChatPanel";
import { connectSocket, joinRoom, startProducing, socket } from "./webrtc";

export default function App() {
  const [currentView, setCurrentView] = useState("home");
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");

  const [participants, setParticipants] = useState([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const localStreamRef = useRef(null);
  const isHostRef = useRef(false);

  // Reset unread count when chat is opened
  useEffect(() => {
    if (isChatOpen) {
      setUnreadCount(0);
    }
  }, [isChatOpen]);

  // Track unread messages
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = () => {
      if (!isChatOpen) {
        setUnreadCount((prev) => prev + 1);
      }
    };

    socket.on("newMessage", handleNewMessage);

    return () => {
      socket.off("newMessage", handleNewMessage);
    };
  }, [isChatOpen]);

  // Debug: Log participants state changes
  useEffect(() => {
    console.log("👥 PARTICIPANTS STATE UPDATED:", participants.map(p => ({
      id: p.id,
      name: p.name,
      hasStream: !!p.stream,
      streamTracks: p.stream?.getTracks?.()?.length || 0
    })));
  }, [participants]);

  useEffect(() => {
    connectSocket();

    // Listen for new peers joining
    socket?.on("newPeer", ({ id, name, isHost }) => {
      console.log("👤 New peer joined:", name, id);
      setParticipants((prev) => {
        // Check if already exists
        if (prev.find(p => p.id === id)) return prev;
        
        return [...prev, {
          id,
          name,
          isHost,
          stream: null,
          streamKey: Date.now()
        }];
      });
    });

    return () => {
      socket?.off("newPeer");
    };
  }, []);

  const startLocalPreview = async () => {
    if (localStreamRef.current) return localStreamRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;
      return stream;
    } catch (err) {
      const isSecure = typeof window !== "undefined" && window.isSecureContext;
      const hasGetUserMedia = !!navigator?.mediaDevices?.getUserMedia;

      if (!isSecure) {
        alert(
          "Camera/Mic blocked because the page is not secure. Open the app on https://<your-ip>:5173 (or http://localhost:5173 on this computer), then allow camera/mic permissions."
        );
        return null;
      }

      if (!hasGetUserMedia) {
        alert("Camera/Mic is not supported in this browser.");
        return null;
      }

      const name = err?.name ? String(err.name) : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        alert("Camera/Mic permission denied. Please allow permissions in the browser and try again.");
        return null;
      }

      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        alert("No camera/microphone found. Please connect a device and try again.");
        return null;
      }

      alert("Unable to access camera/mic. Please check browser permissions and try again.");
      return null;
    }
  };

  const createRoom = async () => {
    const newRoomId = Math.random().toString(36).substring(2, 9).toUpperCase();
    setRoomId(newRoomId);
    
    // Start preview immediately
    await startLocalPreview();
    
    setCurrentView("lobby");
  };

  const goToLobby = async () => {
    if (!roomId.trim()) return alert("Enter Meeting ID");
    
    // Start preview immediately
    await startLocalPreview();
    
    setCurrentView("lobby");
  };

  // ------------------------------
  // ENTER ROOM
  // ------------------------------
  const enterRoom = async () => {
    if (!userName.trim()) return alert("Enter your name");

    const previewStream = await startLocalPreview();
    if (!previewStream) return;

    console.log("🚀 Entering room...");

    const { peers, isHost } = await joinRoom(roomId, userName, (peerId, stream) => {
      console.log("📺 STREAM UPDATE CALLBACK:", {
        peerId,
        streamId: stream.id,
        tracks: stream.getTracks().length,
        video: stream.getVideoTracks().length,
        audio: stream.getAudioTracks().length
      });
      
      // Force update with new stream reference
      setParticipants((prevParticipants) => {
        console.log("   Current participants before update:", prevParticipants.map(p => p.id));
        
        const participantExists = prevParticipants.some(p => p.id === peerId);
        
        if (participantExists) {
          // Update existing participant
          console.log("   ✅ Updating stream for existing participant:", peerId);
          return prevParticipants.map((p) => 
            p.id === peerId 
              ? { ...p, stream, streamKey: Date.now() } 
              : p
          );
        } else {
          // Add new participant (late joiner)
          console.log("   ✅ Adding NEW participant:", peerId);
          return [...prevParticipants, { 
            id: peerId, 
            name: "Remote User", 
            isHost: false, 
            stream,
            streamKey: Date.now()
          }];
        }
      });
    });

    console.log("✅ Room joined. IsHost:", isHost, "Peers:", peers);
    isHostRef.current = isHost;

    // Initialize participants list BEFORE producing
    const initialParticipants = peers
      .filter((p) => p.id !== socket.id)
      .map((p) => {
        console.log("📋 Initial peer:", p);
        return {
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          stream: null,
          streamKey: Date.now()
        };
      });

    console.log("📋 Setting initial participants:", initialParticipants);
    setParticipants((prevParticipants) => {
      const prevById = new Map(prevParticipants.map((pp) => [pp.id, pp]));
      return initialParticipants.map((ip) => {
        const prev = prevById.get(ip.id);
        return prev
          ? {
              ...ip,
              stream: prev.stream ?? ip.stream,
              streamKey: prev.stream ? prev.streamKey : ip.streamKey,
            }
          : ip;
      });
    });

    // CRITICAL: Wait a bit before producing to ensure participants are set
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start producing
    console.log("🎬 Starting to produce streams...");
    await startProducing(previewStream, roomId);

    setCurrentView("room");
  };

  const toggleAudio = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsAudioEnabled(track.enabled);
    }
  };

  const toggleVideo = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsVideoEnabled(track.enabled);
    }
  };

  const leaveRoom = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    setParticipants([]);
    setRoomId("");
    setUserName("");
    setIsChatOpen(false);
    setUnreadCount(0);
    setCurrentView("home");
  };

  const copyRoomId = async () => {
    const text = roomId;
    let success = false;

    try {
      if (navigator?.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        success = true;
      }
    } catch (e) {
      success = false;
    }

    if (!success) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        success = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e) {
        success = false;
      }
    }

    if (!success) {
      window.prompt("Copy meeting ID:", text);
      return;
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // ------------------------------
  // HOME SCREEN
  // ------------------------------
  if (currentView === "home") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-3xl w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Video Conference</h1>
            <p className="text-gray-400">Connect with your team</p>
          </div>

          <button
            onClick={createRoom}
            className="w-full bg-indigo-600 text-white py-4 rounded-xl mb-4 text-lg font-semibold hover:bg-indigo-700 transition"
          >
            Create Meeting
          </button>

          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-gray-800 text-gray-500">OR</span>
            </div>
          </div>

          <input
            className="w-full p-3 bg-gray-700 text-white rounded-xl mb-4 text-center placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="Enter Meeting ID"
          />

          <button
            onClick={goToLobby}
            className="w-full bg-gray-600 text-white py-3 rounded-xl font-semibold hover:bg-gray-700 transition"
          >
            Join Meeting
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------
  // LOBBY
  // ------------------------------
  if (currentView === "lobby") {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 p-8 rounded-3xl w-full max-w-lg">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">Ready to join?</h2>
          
          <VideoTile peerId="local" name="You" stream={localStreamRef.current} />

          <input
            className="w-full p-3 bg-gray-700 text-white rounded-xl my-4 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Your Name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
          />

          <div className="flex justify-between bg-gray-700 p-4 rounded-xl mb-4 text-white">
            <div>
              <div className="text-sm text-gray-400">Meeting ID</div>
              <div className="text-xl font-bold">{roomId}</div>
            </div>
            <button 
              onClick={copyRoomId}
              className="hover:bg-gray-600 p-2 rounded-lg transition"
            >
              {copied ? <Check className="text-green-400" size={24} /> : <Copy size={24} />}
            </button>
          </div>

          <button
            onClick={enterRoom}
            className="w-full bg-indigo-600 text-white py-4 rounded-xl mt-2 font-semibold hover:bg-indigo-700 transition"
          >
            Join Meeting
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------
  // ROOM SCREEN
  // ------------------------------
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="p-4 bg-gray-800 flex justify-between items-center border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          <span className="font-medium">Live</span>
          <span className="text-gray-400">•</span>
          <span className="text-gray-400">Meeting ID: {roomId}</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-gray-400">
            <Users size={18} /> 
            <span>{participants.length + 1}</span>
          </div>
          
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="relative p-2 hover:bg-gray-700 rounded-lg transition"
            title="Toggle Chat"
          >
            <MessageSquare size={22} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Video Grid */}
      <div
        className={`grid gap-4 p-4 flex-1 transition-all duration-300 ${isChatOpen ? 'mr-96' : ''}`}
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
      >
        <VideoTile
          peerId="local"
          name={`${userName}${isHostRef.current ? " (Host)" : ""}`}
          stream={localStreamRef.current}
        />

        {participants.map((p) => (
          <VideoTile
            key={`${p.id}-${p.streamKey || 0}`}
            peerId={p.id}
            name={`${p.name}${p.isHost ? " (Host)" : ""}`}
            stream={p.stream}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="p-4 bg-gray-800 flex justify-center gap-4 border-t border-gray-700">
        <button 
          onClick={toggleAudio} 
          className={`p-4 rounded-xl hover:bg-gray-600 transition ${isAudioEnabled ? 'bg-gray-700' : 'bg-red-600'}`}
          title={isAudioEnabled ? "Mute" : "Unmute"}
        >
          {isAudioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
        </button>

        <button 
          onClick={toggleVideo} 
          className={`p-4 rounded-xl hover:bg-gray-600 transition ${isVideoEnabled ? 'bg-gray-700' : 'bg-red-600'}`}
          title={isVideoEnabled ? "Stop Video" : "Start Video"}
        >
          {isVideoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
        </button>

        <button 
          onClick={leaveRoom} 
          className="p-4 bg-red-600 rounded-xl hover:bg-red-700 transition"
          title="Leave Meeting"
        >
          <PhoneOff size={24} />
        </button>
      </div>

      {/* Chat Panel */}
      <ChatPanel
        roomId={roomId}
        userName={userName}
        socket={socket}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />
    </div>
  );
}