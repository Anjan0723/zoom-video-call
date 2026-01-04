// roomManager.js - Use Render's External IP for WebRTC
// Save as: backend/mediasoup/roomManager.js

const mediasoup = require("mediasoup");
const https = require("https");

const rooms = new Map();
let cachedExternalIp = null;

// ===============================================
// GET RENDER'S EXTERNAL IP
// ===============================================
async function getRenderExternalIp() {
  if (cachedExternalIp) {
    return cachedExternalIp;
  }

  return new Promise((resolve) => {
    // Use multiple IP detection services as fallback
    const services = [
      'https://api.ipify.org',
      'https://icanhazip.com',
      'https://ifconfig.me/ip'
    ];

    const tryService = (index) => {
      if (index >= services.length) {
        console.error('❌ Failed to get external IP from all services');
        resolve(null);
        return;
      }

      https.get(services[index], (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const ip = data.trim();
          if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
            console.log(`✅ Got external IP from ${services[index]}: ${ip}`);
            cachedExternalIp = ip;
            resolve(ip);
          } else {
            console.warn(`⚠️ Invalid IP from ${services[index]}: ${ip}`);
            tryService(index + 1);
          }
        });
      }).on('error', (err) => {
        console.warn(`⚠️ Failed to get IP from ${services[index]}:`, err.message);
        tryService(index + 1);
      }).setTimeout(5000, () => {
        console.warn(`⚠️ Timeout getting IP from ${services[index]}`);
        tryService(index + 1);
      });
    };

    tryService(0);
  });
}

// ===============================================
// GET ANNOUNCED IP
// ===============================================
async function getAnnouncedIp(announcedIpHint) {
  if (process.env.RENDER) {
    // For Render, get the actual external IP
    const externalIp = await getRenderExternalIp();
    if (externalIp) {
      console.log(`🌐 Render mode - using external IP: ${externalIp}`);
      return externalIp;
    }
    
    // Fallback to hostname
    const renderUrl = process.env.RENDER_EXTERNAL_URL || '';
    const hostname = renderUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    console.log(`🌐 Render mode - using hostname fallback: ${hostname}`);
    return hostname;
  }

  if (announcedIpHint) {
    console.log(`🌐 Using client hint: ${announcedIpHint}`);
    return announcedIpHint;
  }

  if (global.ANNOUNCED_IP) {
    console.log(`🌐 Using global IP: ${global.ANNOUNCED_IP}`);
    return global.ANNOUNCED_IP;
  }

  return undefined;
}

// ===============================================
// GET TRANSPORT OPTIONS
// ===============================================
async function getWebRtcTransportOptions(announcedIpHint) {
  const announcedIp = await getAnnouncedIp(announcedIpHint);
  
  const options = {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: announcedIp,
      },
    ],
    enableUdp: false,
    enableTcp: true,
    preferUdp: false,
    preferTcp: true,
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1500000,
  };

  console.log(`🔧 WebRTC Transport Options:`, {
    announcedIp: options.listenIps[0].announcedIp,
    enableUdp: options.enableUdp,
    enableTcp: options.enableTcp,
    preferTcp: options.preferTcp,
    mode: 'TCP-ONLY (FORCED)'
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
        const options = await getWebRtcTransportOptions(announcedIpHint);
        const transport = await this.router.createWebRtcTransport(options);

        this.peers.get(peerId).sendTransport = transport;

        console.log(`✅ Send transport created for ${peerId}:`, {
          id: transport.id,
          iceState: transport.iceState,
          iceCandidatesCount: transport.iceCandidates.length,
          iceCandidates: transport.iceCandidates.map(c => ({
            protocol: c.protocol,
            ip: c.ip,
            port: c.port,
            type: c.type
          }))
        });

        transport.on('icestatechange', (iceState) => {
          console.log(`📡 Send transport ${transport.id} ICE: ${iceState}`);
        });

        transport.on('dtlsstatechange', (dtlsState) => {
          console.log(`🔒 Send transport ${transport.id} DTLS: ${dtlsState}`);
        });

        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
      } catch (error) {
        console.error(`❌ createSendTransport error:`, error);
        throw error;
      }
    },

    async connectSendTransport(peerId, dtlsParameters) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.sendTransport) {
          throw new Error(`Send transport not found for ${peerId}`);
        }
        await peer.sendTransport.connect({ dtlsParameters });
        console.log(`✅ Send transport connected for ${peerId}`);
      } catch (error) {
        console.error(`❌ connectSendTransport error:`, error);
        throw error;
      }
    },

    async produce(peerId, kind, rtpParameters) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.sendTransport) {
          throw new Error(`Send transport not found for ${peerId}`);
        }

        const producer = await peer.sendTransport.produce({
          kind,
          rtpParameters,
        });

        peer.producers.push(producer);

        console.log(`✅ Producer created:`, {
          peerId,
          producerId: producer.id,
          kind: producer.kind,
          paused: producer.paused,
        });

        producer.on('transportclose', () => {
          console.log(`🚪 Producer ${producer.id} transport closed`);
          const index = peer.producers.indexOf(producer);
          if (index > -1) peer.producers.splice(index, 1);
        });

        return producer.id;
      } catch (error) {
        console.error(`❌ produce error:`, error);
        throw error;
      }
    },

    async createRecvTransport(peerId, announcedIpHint) {
      try {
        const options = await getWebRtcTransportOptions(announcedIpHint);
        const transport = await this.router.createWebRtcTransport(options);

        this.peers.get(peerId).recvTransport = transport;

        console.log(`✅ Recv transport created for ${peerId}:`, {
          id: transport.id,
          iceState: transport.iceState,
          iceCandidatesCount: transport.iceCandidates.length,
          iceCandidates: transport.iceCandidates.map(c => ({
            protocol: c.protocol,
            ip: c.ip,
            port: c.port,
            type: c.type
          }))
        });

        transport.on('icestatechange', (iceState) => {
          console.log(`📡 Recv transport ${transport.id} ICE: ${iceState}`);
        });

        transport.on('dtlsstatechange', (dtlsState) => {
          console.log(`🔒 Recv transport ${transport.id} DTLS: ${dtlsState}`);
        });

        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
      } catch (error) {
        console.error(`❌ createRecvTransport error:`, error);
        throw error;
      }
    },

    async connectRecvTransport(peerId, dtlsParameters) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.recvTransport) {
          throw new Error(`Recv transport not found for ${peerId}`);
        }
        await peer.recvTransport.connect({ dtlsParameters });
        console.log(`✅ Recv transport connected for ${peerId}`);
      } catch (error) {
        console.error(`❌ connectRecvTransport error:`, error);
        throw error;
      }
    },

    async consume(peerId, producerId, rtpCapabilities) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.recvTransport) {
          throw new Error(`Recv transport not found for ${peerId}`);
        }

        if (!this.router.canConsume({ producerId, rtpCapabilities })) {
          throw new Error(`Cannot consume producer ${producerId}`);
        }

        const consumer = await peer.recvTransport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
        });

        peer.consumers.push(consumer);

        console.log(`✅ Consumer created:`, {
          peerId,
          consumerId: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          paused: consumer.paused,
        });

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

        return consumer;
      } catch (error) {
        console.error(`❌ consume error:`, error);
        throw error;
      }
    },

    async resumeConsumer(peerId, consumerId) {
      try {
        const peer = this.peers.get(peerId);
        if (!peer) throw new Error(`Peer ${peerId} not found`);

        const consumer = peer.consumers.find((c) => c.id === consumerId);
        if (!consumer) throw new Error(`Consumer ${consumerId} not found`);

        if (consumer.paused) {
          await consumer.resume();
          console.log(`✅ Consumer resumed: ${consumerId} (${consumer.kind})`);

          if (consumer.kind === "video" && typeof consumer.requestKeyFrame === "function") {
            try {
              await consumer.requestKeyFrame();
              console.log(`🔑 Keyframe requested for ${consumerId}`);
            } catch (e) {
              console.warn(`⚠️ Keyframe request failed:`, e.message);
            }
          }
        }
      } catch (error) {
        console.error(`❌ resumeConsumer error:`, error);
        throw error;
      }
    },
  };

  rooms.set(roomId, room);
  console.log(`✅ Room ${roomId} created`);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

module.exports = { createRoom, getRoom };