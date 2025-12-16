// ChatPanel.jsx (HTTP VERSION)
// Save as: frontend/src/components/ChatPanel.jsx
// ONLY LINE 54 changed: https -> http

import React, { useState, useRef, useEffect } from "react";
import { Send, Paperclip, X, Download, FileText, Image as ImageIcon, File, Trash2 } from "lucide-react";

export default function ChatPanel({ roomId, userName, socket, isOpen, onClose }) {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);
    };

    socket.on("newMessage", handleNewMessage);

    return () => {
      socket.off("newMessage", handleNewMessage);
    };
  }, [socket]);

  const sendMessage = () => {
    if (!inputMessage.trim()) return;

    const newMessage = {
      id: `${socket.id}-${Date.now()}`,
      senderId: socket.id,
      senderName: userName,
      message: inputMessage,
      timestamp: new Date().toISOString(),
      type: 'text'
    };

    setMessages((prev) => [...prev, newMessage]);
    
    socket.emit("sendMessage", {
      roomId,
      message: inputMessage,
      senderName: userName
    });

    setInputMessage("");
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    
    if (files.length === 0) return;

    const validFiles = files.filter(file => {
      if (file.size > 10 * 1024 * 1024) {
        alert(`${file.name} is too large. Max size: 10MB`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    setSelectedFiles(prev => [...prev, ...validFiles]);

    validFiles.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setFilePreviews(prev => [...prev, {
            name: file.name,
            url: e.target.result,
            type: 'image'
          }]);
        };
        reader.readAsDataURL(file);
      } else {
        setFilePreviews(prev => [...prev, {
          name: file.name,
          url: null,
          type: 'file'
        }]);
      }
    });

    fileInputRef.current.value = "";
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setFilePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const cancelFileUpload = () => {
    setSelectedFiles([]);
    setFilePreviews([]);
  };

  const uploadAndSendFiles = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);

    try {
      const backend = `http://${window.location.hostname}:3001`;  // CHANGED: https -> http
      
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${backend}/upload`, {
          method: 'POST',
          body: formData
        });

        const data = await response.json();

        if (data.success) {
          const fileMessage = {
            id: `${socket.id}-${Date.now()}-${Math.random()}`,
            senderId: socket.id,
            senderName: userName,
            message: data.fileName,
            timestamp: new Date().toISOString(),
            type: 'file',
            fileUrl: data.fileUrl,
            fileSize: data.fileSize,
            mimeType: data.mimeType
          };

          setMessages((prev) => [...prev, fileMessage]);

          socket.emit("shareFile", {
            roomId,
            fileData: {
              fileName: data.fileName,
              fileUrl: data.fileUrl,
              fileSize: data.fileSize,
              mimeType: data.mimeType
            },
            senderName: userName
          });
        }
      }

      setSelectedFiles([]);
      setFilePreviews([]);
      
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload files. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (mimeType) => {
    if (mimeType?.startsWith('image/')) return <ImageIcon size={20} />;
    if (mimeType?.startsWith('video/')) return <File size={20} />;
    if (mimeType?.includes('pdf')) return <FileText size={20} />;
    return <File size={20} />;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-gray-800 shadow-2xl flex flex-col z-50 border-l border-gray-700">
      <div className="p-4 bg-gray-900 border-b border-gray-700 flex justify-between items-center">
        <h2 className="text-white font-semibold text-lg">Chat</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            No messages yet. Start the conversation!
          </div>
        )}

        {messages.map((msg) => {
          const isOwn = msg.senderId === socket.id;
          
          return (
            <div
              key={msg.id}
              className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-xs ${isOwn ? 'bg-indigo-600' : 'bg-gray-700'} rounded-lg p-3`}>
                {!isOwn && (
                  <div className="text-xs text-gray-300 mb-1 font-medium">
                    {msg.senderName}
                  </div>
                )}

                {msg.type === 'text' ? (
                  <div className="text-white break-words">{msg.message}</div>
                ) : (
                  <a
                    href={msg.fileUrl}
                    download
                    className="flex items-center gap-2 text-white hover:underline"
                  >
                    {getFileIcon(msg.mimeType)}
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm">{msg.message}</div>
                      <div className="text-xs text-gray-300">
                        {formatFileSize(msg.fileSize)}
                      </div>
                    </div>
                    <Download size={16} className="flex-shrink-0" />
                  </a>
                )}

                <div className="text-xs text-gray-300 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </div>
              </div>
            </div>
          );
        })}
        
        <div ref={messagesEndRef} />
      </div>

      {selectedFiles.length > 0 && (
        <div className="border-t border-gray-700 bg-gray-900 p-4 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white text-sm font-medium">
              {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
            </span>
            <button
              onClick={cancelFileUpload}
              className="text-red-400 hover:text-red-300 text-sm"
            >
              Clear All
            </button>
          </div>

          <div className="space-y-2 mb-3">
            {filePreviews.map((preview, index) => (
              <div
                key={index}
                className="bg-gray-800 rounded-lg p-2 flex items-center gap-3"
              >
                <div className="w-12 h-12 flex-shrink-0 bg-gray-700 rounded flex items-center justify-center overflow-hidden">
                  {preview.type === 'image' ? (
                    <img
                      src={preview.url}
                      alt={preview.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileText size={24} className="text-gray-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm truncate">
                    {preview.name}
                  </div>
                  <div className="text-gray-400 text-xs">
                    {formatFileSize(selectedFiles[index].size)}
                  </div>
                </div>

                <button
                  onClick={() => removeFile(index)}
                  className="text-red-400 hover:text-red-300 p-1"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={cancelFileUpload}
              className="flex-1 bg-gray-700 text-white py-2 rounded-lg hover:bg-gray-600 transition"
              disabled={isUploading}
            >
              Cancel
            </button>
            <button
              onClick={uploadAndSendFiles}
              className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
              disabled={isUploading}
            >
              {isUploading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Uploading...
                </div>
              ) : (
                `Send ${selectedFiles.length > 1 ? `${selectedFiles.length} files` : 'file'}`
              )}
            </button>
          </div>
        </div>
      )}

      <div className="p-4 bg-gray-900 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Type a message..."
            className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={isUploading}
          />
          
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            multiple
          />
          
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="p-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 transition"
            title="Attach files"
          >
            <Paperclip size={20} />
          </button>
          
          <button
            onClick={sendMessage}
            disabled={!inputMessage.trim() || isUploading}
            className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            title="Send message"
          >
            <Send size={20} />
          </button>
        </div>
        
        <div className="text-xs text-gray-500 mt-2">
          Max file size: 10MB per file • Multiple files supported
        </div>
      </div>
    </div>
  );
}