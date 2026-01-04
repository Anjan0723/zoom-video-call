module.exports = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:numb.viagenie.ca",
      username: "webrtc@live.com",
      credential: "muazkh"
    },
    {
      urls: "turn:relay.metered.ca:80",
      username: "d0a13e0472c6803d3ddc6dd6",
      credential: "d0a13e0472c6803d3ddc6dd6"
    },
    {
      urls: "turn:relay.metered.ca:443",
      username: "d0a13e0472c6803d3ddc6dd6",
      credential: "d0a13e0472c6803d3ddc6dd6"
    }
  ]
};
