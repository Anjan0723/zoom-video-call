// server.js (Docker-ready version with HTTPS support)
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
// AUTO-DETECT LOCAL IP ADDRESS
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

// Use environment variable if set (for Docker), otherwise auto-detect
const LOCAL_IP = process.env.ANNOUNCED_IP || getLocalIPAddress();
console.log(`📍 Using IP Address: ${LOCAL_IP}`);
console.log(`   (Source: ${process.env.ANNOUNCED_IP ? 'Environment Variable' : 'Auto-detected'})`);

// Export for use in roomManager
global.ANNOUNCED_IP = LOCAL_IP;

// ------------------------------
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

// ------------------------------
const io = socketIO(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 10e6
});

// ------------------------------
// CREATE MEDIASOUP WORKER
// ------------------------------
let worker;
(async () => {
  const mediasoup = require("mediasoup");

  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 40100,
  });

  console.log("✅ Mediasoup Worker started");
})();

// ------------------------------
// FILE UPLOAD ENDPOINT
// ------------------------------
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      console.error("❌ No file uploaded");
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Use protocol from request or default to https in production
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `${LOCAL_IP}:3001`;
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

// ------------------------------
// HEALTH CHECK ENDPOINT
// ------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ------------------------------
// SOCKET LOGIC
// ------------------------------
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
  } catch (e) {}
  return null;
}

io.on("connection", (socket) => {
  console.log("👤 User connected:", socket.id);

  socket.data = socket.data || {};
  socket.data.announcedIpHint = getClientHostnameFromSocket(socket);
  if (socket.data.announcedIpHint) {
    console.log(`🌐 announcedIpHint for ${socket.id}: ${socket.data.announcedIpHint}`);
  }

  socket.on("joinRoom", async ({ roomId, name }, callback) => {
    let room = getRoom(roomId);
    const isHost = !room;

    if (!room) room = await createRoom(roomId, worker);

    const peer = room.addPeer(socket.id, name);
    peer.isHost = isHost;

    socket.join(roomId);

    console.log(`✅ ${name} joined room ${roomId} as ${isHost ? 'HOST' : 'PARTICIPANT'}`);

    callback({
      rtpCapabilities: room.router.rtpCapabilities,
      peers: room.getPeerList(),
      isHost,
    });

    socket.to(roomId).emit("newPeer", {
      id: peer.id,
      name: peer.name,
      isHost,
    });

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
  });

  socket.on("sendMessage", ({ roomId, message, senderName }) => {
    const timestamp = new Date().toISOString();
    
    console.log(`💬 Message from ${senderName} in room ${roomId}: ${message}`);
    
    socket.to(roomId).emit("newMessage", {
      id: `${socket.id}-${Date.now()}`,
      senderId: socket.id,
      senderName,
      message,
      timestamp,
      type: 'text'
    });
  });

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

  socket.on("createSendTransport", async ({ roomId, clientHost }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    const transportParams = await room.createSendTransport(socket.id, clientHost || socket.data?.announcedIpHint);
    try {
      console.log(`🧊 sendTransport iceCandidates for ${socket.id}:`, transportParams.iceCandidates?.map(c => ({ protocol: c.protocol, ip: c.ip, port: c.port })));
    } catch (e) {}
    callback(transportParams);
  });

  socket.on("connectSendTransport", async ({ roomId, dtlsParameters }) => {
    const room = getRoom(roomId);
    if (!room) return;
    await room.connectSendTransport(socket.id, dtlsParameters);
  });

  socket.on("produce", async ({ roomId, kind, rtpParameters }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    const producerId = await room.produce(socket.id, kind, rtpParameters);

    socket.to(roomId).emit("newProducer", {
      producerId,
      peerId: socket.id,
      kind,
    });

    callback({ id: producerId });
  });

  socket.on("createRecvTransport", async ({ roomId, clientHost }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    const recvParams = await room.createRecvTransport(socket.id, clientHost || socket.data?.announcedIpHint);
    try {
      console.log(`🧊 recvTransport iceCandidates for ${socket.id}:`, recvParams.iceCandidates?.map(c => ({ protocol: c.protocol, ip: c.ip, port: c.port })));
    } catch (e) {}
    callback(recvParams);
  });

  socket.on("connectRecvTransport", async ({ roomId, dtlsParameters }) => {
    const room = getRoom(roomId);
    if (!room) return;

    await room.connectRecvTransport(socket.id, dtlsParameters);
  });

  socket.on("consume", async ({ roomId, producerId, rtpCapabilities }, callback) => {
    const room = getRoom(roomId);
    if (!room) return callback({ error: "Room not found" });

    try {
      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
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
      callback({ error: err.toString() });
    }
  });

  socket.on("resumeConsumer", async ({ roomId, consumerId }) => {
    const room = getRoom(roomId);
    if (!room) return;

    await room.resumeConsumer(socket.id, consumerId);
  });

  socket.on("disconnect", () => {
    console.log("👋 User disconnected:", socket.id);
  });
});

// ---------------------------------------
// START SERVER
// ---------------------------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  const isDocker = process.env.ANNOUNCED_IP && !process.env.RENDER ? true : false;
  const proto = useHttps ? "https" : "http";
  
  console.log("\n🎉 ================================");
  console.log("   VIDEO CONFERENCE SERVER READY");
  console.log(`   ${isDocker ? 'DOCKER MODE' : (useHttps ? 'HTTPS MODE' : 'HTTP MODE')}`);
  console.log("   ================================");
  console.log(`\n📍 Announced IP: ${LOCAL_IP}`);
  console.log(`\n🔗 Backend API: ${proto}://${LOCAL_IP}:${PORT}`);
  
  if (!isDocker) {
    console.log(`\n🌐 Access from:`);
    console.log(`   • This computer:  ${proto}://localhost:${PORT}`);
    console.log(`   • Same network:   ${proto}://${LOCAL_IP}:${PORT}`);
  } else {
    console.log(`\n🐳 Running in Docker - HTTPS handled by Nginx`);
  }
  
  console.log(`\n📁 Uploads directory: ${path.join(__dirname, 'uploads')}`);
  console.log("================================\n");
});