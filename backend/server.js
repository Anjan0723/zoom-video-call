// server.js - Complete Fixed Version for Render Deployment
// Save as: backend/server.js

const express = require("express");
const http = require("http");
const https = require("https");
const socketIO = require("socket.io");
const cors = require("cors");
const os = require("os");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { getRoom, createRoom } = require("./mediasoup/roomManager");

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ===============================================
// FILE UPLOAD SETUP
// ===============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===============================================
// GET LOCAL IP ADDRESS
// ===============================================
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return 'localhost';
}

// ===============================================
// DETERMINE ANNOUNCED IP
// ===============================================
function getAnnouncedIp() {
  // For Render deployment
  if (process.env.RENDER) {
    const renderUrl = process.env.RENDER_EXTERNAL_URL || '';
    const hostname = renderUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    if (hostname) {
      console.log('🌐 Render detected - using hostname:', hostname);
      return hostname;
    }
  }
  
  // For Docker or local with env variable
  if (process.env.ANNOUNCED_IP) {
    console.log('🐳 Using ANNOUNCED_IP from environment:', process.env.ANNOUNCED_IP);
    return process.env.ANNOUNCED_IP;
  }
  
  // For local development
  const localIp = getLocalIPAddress();
  console.log('🏠 Using auto-detected local IP:', localIp);
  return localIp;
}

const ANNOUNCED_IP = getAnnouncedIp();
console.log(`\n📍 Final Announced IP: ${ANNOUNCED_IP}`);
console.log(`   Environment: ${process.env.RENDER ? 'RENDER (Production)' : 'LOCAL/DOCKER (Development)'}\n`);

// Export for use in roomManager
global.ANNOUNCED_IP = ANNOUNCED_IP;

// ===============================================
// HTTPS SETUP (for local development only)
// ===============================================
const useHttps =
  String(process.env.USE_HTTPS || "").toLowerCase() === "true" ||
  String(process.env.USE_HTTPS || "").toLowerCase() === "1";

const sslKeyPath = path.join(__dirname, "ssl/key.pem");
const sslCertPath = path.join(__dirname, "ssl/cert.pem");

const server = useHttps && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)
  ? https.createServer({
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    }, app)
  : http.createServer(app);

console.log(`🔒 Using ${useHttps ? 'HTTPS' : 'HTTP'} for server`);

// ===============================================
// SOCKET.IO SETUP
// ===============================================
const io = socketIO(server, {
  cors: { 
    origin: "*", 
    methods: ["GET", "POST"] 
  },
  maxHttpBufferSize: 10e6,
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
});

console.log('✅ Socket.IO configured\n');

// ===============================================
// MEDIASOUP WORKER SETUP
// ===============================================
let worker;

(async () => {
  try {
    const mediasoup = require("mediasoup");

    const workerSettings = {
      rtcMinPort: 40000,
      rtcMaxPort: 40100,
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
      ],
    };

    console.log('🔧 Creating Mediasoup Worker with settings:', workerSettings);

    worker = await mediasoup.createWorker(workerSettings);

    console.log("✅ Mediasoup Worker created successfully");
    console.log(`   Worker PID: ${worker.pid}`);
    console.log(`   RTC Ports: ${workerSettings.rtcMinPort}-${workerSettings.rtcMaxPort}\n`);

    // Handle worker death
    worker.on('died', (error) => {
      console.error('❌ Mediasoup worker died:', error);
      console.error('   Exiting in 2 seconds...');
      setTimeout(() => process.exit(1), 2000);
    });
  } catch (error) {
    console.error('❌ Failed to create Mediasoup worker:', error);
    process.exit(1);
  }
})();

// ===============================================
// HTTP ROUTES
// ===============================================

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      console.error("❌ No file uploaded");
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Use the correct protocol (especially important for Render)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers.host || `${ANNOUNCED_IP}:${process.env.PORT || 3001}`;
    const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    
    console.log(`✅ File uploaded: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);
    
    res.json({
      success: true,
      fileName: req.file.originalname,
      fileUrl: fileUrl,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    announcedIp: ANNOUNCED_IP,
    environment: process.env.RENDER ? 'render' : 'local',
    workerReady: !!worker,
  });
});

// ===============================================
// HELPER FUNCTION
// ===============================================
function getClientHostnameFromSocket(socket) {
  try {
    const origin = socket?.handshake?.headers?.origin;
    if (origin) {
      const u = new URL(origin);
      const host = u.hostname;
      if (!host) return null;
      if (host === "localhost" || host === "127.0.0.1" || host.startsWith("127.")) return null;
      return host;
    }
  } catch (e) {
    console.warn('Could not extract hostname from socket:', e.message);
  }
  return null;
}

// ===============================================
// SOCKET.IO EVENT HANDLERS
// ===============================================
io.on("connection", (socket) => {
  console.log("👤 User connected:", socket.id);

  // Store client hostname hint
  socket.data = socket.data || {};
  socket.data.announcedIpHint = getClientHostnameFromSocket(socket);
  if (socket.data.announcedIpHint) {
    console.log(`🌐 Client hostname hint for ${socket.id}: ${socket.data.announcedIpHint}`);
  }

  // Join room
  socket.on("joinRoom", async ({ roomId, name }, callback) => {
    try {
      if (!worker) {
        console.error('❌ Worker not ready yet');
        return callback({ error: "Server not ready, please try again" });
      }

      let room = getRoom(roomId);
      const isHost = !room;

      if (!room) {
        console.log(`📝 Creating new room: ${roomId}`);
        room = await createRoom(roomId, worker);
      }

      const peer = room.addPeer(socket.id, name);
      peer.isHost = isHost;

      socket.join(roomId);

      console.log(`✅ ${name} joined room ${roomId} as ${isHost ? 'HOST' : 'PARTICIPANT'}`);

      callback({
        rtpCapabilities: room.router.rtpCapabilities,
        peers: room.getPeerList(),
        isHost,
      });

      // Notify other peers
      socket.to(roomId).emit("newPeer", {
        id: peer.id,
        name: peer.name,
        isHost,
      });

      // Send existing producers to new peer
      room.peers.forEach((p) => {
        if (p.id === socket.id) return;

        p.producers.forEach((prod) => {
          socket.emit("newProducer", {
            producerId: prod.id,
            peerId: p.id,
            kind: prod.kind,
          });
        });
      });
    } catch (error) {
      console.error('❌ joinRoom error:', error);
      callback({ error: error.message });
    }
  });

  // Send message
  socket.on("sendMessage", ({ roomId, message, senderName }) => {
    const timestamp = new Date().toISOString();
    
    console.log(`💬 Message from ${senderName} in room ${roomId}`);
    
    socket.to(roomId).emit("newMessage", {
      id: `${socket.id}-${Date.now()}`,
      senderId: socket.id,
      senderName,
      message,
      timestamp,
      type: 'text'
    });
  });

  // Share file
  socket.on("shareFile", ({ roomId, fileData, senderName }) => {
    const timestamp = new Date().toISOString();
    
    console.log(`📎 File shared by ${senderName} in room ${roomId}: ${fileData.fileName}`);
    
    socket.to(roomId).emit("newMessage", {
      id: `${socket.id}-${Date.now()}`,
      senderId: socket.id,
      senderName,
      message: fileData.fileName,
      timestamp,
      type: 'file',
      fileUrl: fileData.fileUrl,
      fileSize: fileData.fileSize,
      mimeType: fileData.mimeType
    });
  });

  // Create send transport
  socket.on("createSendTransport", async ({ roomId, clientHost }, callback) => {
    try {
      const room = getRoom(roomId);
      if (!room) {
        console.error(`❌ Room ${roomId} not found`);
        return callback({ error: "Room not found" });
      }

      const hint = clientHost || socket.data?.announcedIpHint;
      const transportParams = await room.createSendTransport(socket.id, hint);
      
      callback(transportParams);
    } catch (error) {
      console.error('❌ createSendTransport error:', error);
      callback({ error: error.message });
    }
  });

  // Connect send transport
  socket.on("connectSendTransport", async ({ roomId, dtlsParameters }) => {
    try {
      const room = getRoom(roomId);
      if (!room) {
        console.error(`❌ Room ${roomId} not found`);
        return;
      }
      await room.connectSendTransport(socket.id, dtlsParameters);
    } catch (error) {
      console.error('❌ connectSendTransport error:', error);
    }
  });

  // Produce
  socket.on("produce", async ({ roomId, kind, rtpParameters }, callback) => {
    try {
      const room = getRoom(roomId);
      if (!room) {
        console.error(`❌ Room ${roomId} not found`);
        return callback({ error: "Room not found" });
      }

      const producerId = await room.produce(socket.id, kind, rtpParameters);

      // Notify other peers about new producer
      socket.to(roomId).emit("newProducer", {
        producerId,
        peerId: socket.id,
        kind,
      });

      callback({ id: producerId });
    } catch (error) {
      console.error('❌ produce error:', error);
      callback({ error: error.message });
    }
  });

  // Create recv transport
  socket.on("createRecvTransport", async ({ roomId, clientHost }, callback) => {
    try {
      const room = getRoom(roomId);
      if (!room) {
        console.error(`❌ Room ${roomId} not found`);
        return callback({ error: "Room not found" });
      }

      const hint = clientHost || socket.data?.announcedIpHint;
      const recvParams = await room.createRecvTransport(socket.id, hint);
      
      callback(recvParams);
    } catch (error) {
      console.error('❌ createRecvTransport error:', error);
      callback({ error: error.message });
    }
  });

  // Connect recv transport
  socket.on("connectRecvTransport", async ({ roomId, dtlsParameters }) => {
    try {
      const room = getRoom(roomId);
      if (!room) {
        console.error(`❌ Room ${roomId} not found`);
        return;
      }

      await room.connectRecvTransport(socket.id, dtlsParameters);
    } catch (error) {
      console.error('❌ connectRecvTransport error:', error);
    }
  });

  // Consume
  socket.on("consume", async ({ roomId, producerId, rtpCapabilities }, callback) => {
    try {
      const room = getRoom(roomId);
      if (!room) {
        console.error(`❌ Room ${roomId} not found`);
        return callback({ error: "Room not found" });
      }

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        console.warn(`⚠️ Cannot consume producer ${producerId}`);
        return callback({ error: "Cannot consume" });
      }

      const consumer = await room.consume(socket.id, producerId, rtpCapabilities);

      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      console.error("❌ Consume error:", err);
      callback({ error: err.message });
    }
  });

  // Resume consumer
  socket.on("resumeConsumer", async ({ roomId, consumerId }) => {
    try {
      const room = getRoom(roomId);
      if (!room) {
        console.error(`❌ Room ${roomId} not found`);
        return;
      }

      await room.resumeConsumer(socket.id, consumerId);
    } catch (error) {
      console.error('❌ resumeConsumer error:', error);
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("👋 User disconnected:", socket.id);
  });
});

// ===============================================
// START SERVER
// ===============================================
const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
  const proto = useHttps ? "https" : "http";
  const isRender = !!process.env.RENDER;
  
  console.log("\n🎉 ================================");
  console.log("   VIDEO CONFERENCE SERVER READY");
  console.log(`   ${isRender ? 'RENDER MODE' : 'LOCAL MODE'}`);
  console.log("   ================================");
  console.log(`\n📍 Announced IP: ${ANNOUNCED_IP}`);
  console.log(`📡 Server URL: ${proto}://${ANNOUNCED_IP}:${PORT}`);
  console.log(`🔌 Socket.IO: Listening`);
  console.log(`📁 Uploads: ${path.join(__dirname, 'uploads')}`);
  console.log(`\n⚙️  WebRTC Mode: ${isRender ? 'TCP-only (Production)' : 'UDP+TCP (Development)'}`);
  
  if (!isRender) {
    console.log(`\n🌐 Access from:`);
    console.log(`   • This computer:  ${proto}://localhost:${PORT}`);
    console.log(`   • Same network:   ${proto}://${ANNOUNCED_IP}:${PORT}`);
  }
  
  console.log("\n================================\n");
});