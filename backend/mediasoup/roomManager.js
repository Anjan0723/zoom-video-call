// roomManager.js - Complete Fixed Version for Render Deployment
// Save as: backend/mediasoup/roomManager.js

const mediasoup = require("mediasoup");

const rooms = new Map();

// ===============================================
// GET ANNOUNCED IP FOR RENDER OR LOCAL
// ===============================================
function getAnnouncedIP(announcedIpHint) {
  // Priority 1: Use Render's external hostname
  if (process.env.RENDER) {
    const renderUrl = process.env.RENDER_EXTERNAL_URL || '';
    const hostname = renderUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    if (hostname) {
      console.log(`🌐 Using Render hostname: ${hostname}`);
      return hostname;
    }
  }

  // Priority 2: Use provided hint from client
  if (announcedIpHint && announcedIpHint !== 'localhost' && announcedIpHint !== '127.0.0.1') {
    console.log(`🌐 Using client hint: ${announcedIpHint}`);
    return announcedIpHint;
  }

  // Priority 3: Use global variable set by server.js
  if (global.ANNOUNCED_IP) {
    console.log(`🌐 Using global.ANNOUNCED_IP: ${global.ANNOUNCED_IP}`);
    return global.ANNOUNCED_IP;
  }

  // Priority 4: Use environment variable
  if (process.env.ANNOUNCED_IP) {
    console.log(`🌐 Using ANNOUNCED_IP env: ${process.env.ANNOUNCED_IP}`);
    return process.env.ANNOUNCED_IP;
  }

  console.warn('⚠️ No announced IP found, using undefined');
  return undefined;
}

// ===============================================
// GET WEBRTC TRANSPORT OPTIONS
// ===============================================
function getWebRtcTransportOptions(announcedIpHint) {
  const announcedIp = getAnnouncedIP(announcedIpHint);
  
  // Detect if running on Render or production
  const isProduction = process.env.RENDER || process.env.NODE_ENV === 'production';
  
  const options = {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: announcedIp,
      },
    ],
    // For Render: Disable UDP, use TCP only
    enableUdp: !isProduction,
    enableTcp: true,
    preferUdp: !isProduction,
    preferTcp: isProduction,
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1500000,
  };

  console.log(`🔧 WebRTC Transport Config:`, {
    announcedIp: options.listenIps[0].announcedIp || 'undefined (local)',
    enableUdp: options.enableUdp,
    enableTcp: options.enableTcp,
    preferTcp: options.preferTcp,
    mode: isProduction ? 'PRODUCTION (TCP-only)' : 'DEVELOPMENT (UDP+TCP)'
  });

  return options;
}

// ===============================================
// CREATE ROOM
// ===============================================
async function createRoom(roomId, worker) {
  const mediaCodecs = [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video",
      mimeType: "video/VP8",
      clockRate: 90000,
      parameters: {
        "x-google-start-bitrate": 1000,
      },
    },
    {
      kind: "video",
      mimeType: "video/H264",
      clockRate: 90000,
      parameters: {
        "packetization-mode": 1,
        "profile-level-id": "42e01f",
        "level-asymmetry-allowed": 1,
      },
    },
  ];

  const router = await worker.createRouter({ mediaCodecs });

  console.log(`✅ Router created for room ${roomId}`);

  const room = {
    id: roomId,
    router,
    peers: new Map(),

    addPeer(id, name) {
      const peer = {
        id,
        name,
        isHost: false,
        sendTransport: null,
        recvTransport: null,
        producers: [],
        consumers: [],
      };

      this.peers.set(id, peer);
      console.log(`👤 Peer added: ${name} (${id})`);
      return peer;
    },

    getPeerList() {
      return [...this.peers.values()].map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        videoProducers: p.producers
          .filter((prod) => prod.kind === "video")
          .map((prod) => prod.id),
        audioProducers: p.producers
          .filter((prod) => prod.kind === "audio")
          .map((prod) => prod.id),
      }));
    },

    async createSendTransport(peerId, announcedIpHint) {
      try {
        const options = getWebRtcTransportOptions(announcedIpHint);
        const transport = await this.router.createWebRtcTransport(options);

        this.peers.get(peerId).sendTransport = transport;

        console.log(`✅ Send transport created for ${peerId}:`, {
          id: transport.id,
          iceState: transport.iceState,
          iceCandidates: transport.iceCandidates.length,
        });

        // Monitor transport state
        transport.on('icestatechange', (iceState) => {
          console.log(`📡 Send transport ${transport.id} ICE state:`, iceState);
        });

        transport.on('dtlsstatechange', (dtlsState) => {
          console.log(`🔒 Send transport ${transport.id} DTLS state:`, dtlsState);
          if (dtlsState === 'failed' || dtlsState === 'closed') {
            console.error(`❌ Send transport ${transport.id} failed`);
          }
        });

        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
      } catch (error) {
        console.error(`❌ Failed to create send transport for ${peerId}:`, error);
        throw error;
      }
    },

    async connectSendTransport(peerId, dtlsParameters) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.sendTransport) {
          throw new Error(`Send transport not found for peer ${peerId}`);
        }

        await peer.sendTransport.connect({ dtlsParameters });
        console.log(`✅ Send transport connected for ${peerId}`);
      } catch (error) {
        console.error(`❌ Failed to connect send transport for ${peerId}:`, error);
        throw error;
      }
    },

    async produce(peerId, kind, rtpParameters) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.sendTransport) {
          throw new Error(`Send transport not found for peer ${peerId}`);
        }

        const producer = await peer.sendTransport.produce({
          kind,
          rtpParameters,
        });

        peer.producers.push(producer);

        console.log(`✅ Producer created for ${peerId}:`, {
          id: producer.id,
          kind: producer.kind,
          type: producer.type,
          paused: producer.paused,
        });

        // Monitor producer state
        producer.on('transportclose', () => {
          console.log(`🚪 Producer ${producer.id} transport closed`);
          const index = peer.producers.indexOf(producer);
          if (index > -1) peer.producers.splice(index, 1);
        });

        producer.on('score', (score) => {
          // Log periodically for debugging
          if (Math.random() < 0.1) { // 10% chance to reduce log spam
            console.log(`📊 Producer ${producer.id} score:`, score);
          }
        });

        return producer.id;
      } catch (error) {
        console.error(`❌ Failed to create producer for ${peerId}:`, error);
        throw error;
      }
    },

    async createRecvTransport(peerId, announcedIpHint) {
      try {
        const options = getWebRtcTransportOptions(announcedIpHint);
        const transport = await this.router.createWebRtcTransport(options);

        this.peers.get(peerId).recvTransport = transport;

        console.log(`✅ Recv transport created for ${peerId}:`, {
          id: transport.id,
          iceState: transport.iceState,
          iceCandidates: transport.iceCandidates.length,
        });

        // Monitor transport state
        transport.on('icestatechange', (iceState) => {
          console.log(`📡 Recv transport ${transport.id} ICE state:`, iceState);
        });

        transport.on('dtlsstatechange', (dtlsState) => {
          console.log(`🔒 Recv transport ${transport.id} DTLS state:`, dtlsState);
          if (dtlsState === 'failed' || dtlsState === 'closed') {
            console.error(`❌ Recv transport ${transport.id} failed`);
          }
        });

        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
      } catch (error) {
        console.error(`❌ Failed to create recv transport for ${peerId}:`, error);
        throw error;
      }
    },

    async connectRecvTransport(peerId, dtlsParameters) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.recvTransport) {
          throw new Error(`Recv transport not found for peer ${peerId}`);
        }

        await peer.recvTransport.connect({ dtlsParameters });
        console.log(`✅ Recv transport connected for ${peerId}`);
      } catch (error) {
        console.error(`❌ Failed to connect recv transport for ${peerId}:`, error);
        throw error;
      }
    },

    async consume(peerId, producerId, rtpCapabilities) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.recvTransport) {
          throw new Error(`Recv transport not found for peer ${peerId}`);
        }

        // Verify producer exists
        let producerPeer = null;
        for (const [pid, p] of this.peers) {
          const producer = p.producers.find(prod => prod.id === producerId);
          if (producer) {
            producerPeer = p;
            break;
          }
        }

        if (!producerPeer) {
          throw new Error(`Producer ${producerId} not found`);
        }

        // Check if can consume
        if (!this.router.canConsume({ producerId, rtpCapabilities })) {
          throw new Error(`Cannot consume producer ${producerId}`);
        }

        const consumer = await peer.recvTransport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // Start paused, will be resumed by client
        });

        peer.consumers.push(consumer);

        console.log(`✅ Consumer created for ${peerId}:`, {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          type: consumer.type,
          paused: consumer.paused,
        });

        // Monitor consumer state
        consumer.on('transportclose', () => {
          console.log(`🚪 Consumer ${consumer.id} transport closed`);
          const index = peer.consumers.indexOf(consumer);
          if (index > -1) peer.consumers.splice(index, 1);
        });

        consumer.on('producerclose', () => {
          console.log(`🚪 Consumer ${consumer.id} producer closed`);
          const index = peer.consumers.indexOf(consumer);
          if (index > -1) peer.consumers.splice(index, 1);
        });

        consumer.on('producerpause', () => {
          console.log(`⏸️ Consumer ${consumer.id} producer paused`);
        });

        consumer.on('producerresume', () => {
          console.log(`▶️ Consumer ${consumer.id} producer resumed`);
        });

        consumer.on('score', (score) => {
          // Log periodically for debugging
          if (Math.random() < 0.1) { // 10% chance to reduce log spam
            console.log(`📊 Consumer ${consumer.id} score:`, score);
          }
        });

        return consumer;
      } catch (error) {
        console.error(`❌ Failed to create consumer for ${peerId}:`, error);
        throw error;
      }
    },

    async resumeConsumer(peerId, consumerId) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer) {
          throw new Error(`Peer ${peerId} not found`);
        }

        const consumer = peer.consumers.find((c) => c.id === consumerId);
        if (!consumer) {
          throw new Error(`Consumer ${consumerId} not found for peer ${peerId}`);
        }

        if (consumer.paused) {
          await consumer.resume();
          console.log(`✅ Consumer resumed: ${consumerId} (${consumer.kind}) for peer ${peerId}`);

          // Request keyframe for video consumers
          if (consumer.kind === "video" && typeof consumer.requestKeyFrame === "function") {
            try {
              await consumer.requestKeyFrame();
              console.log(`🔑 Keyframe requested for consumer ${consumerId}`);
            } catch (error) {
              console.warn(`⚠️ Could not request keyframe for ${consumerId}:`, error.message);
            }
          }
        } else {
          console.log(`ℹ️ Consumer ${consumerId} already resumed`);
        }
      } catch (error) {
        console.error(`❌ Failed to resume consumer ${consumerId} for ${peerId}:`, error);
        throw error;
      }
    },
  };

  rooms.set(roomId, room);
  console.log(`✅ Room ${roomId} created and stored`);
  return room;
}

// ===============================================
// GET ROOM
// ===============================================
function getRoom(roomId) {
  return rooms.get(roomId);
}

// ===============================================
// EXPORTS
// ===============================================
module.exports = { createRoom, getRoom };