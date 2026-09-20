// Low-latency WebRTC P2P DataChannel transport layer for Class 2D War.
// Uses Google public STUN servers. Employs unordered, unreliable DataChannels
// (UDP-like) for continuous real-time gaming packets (inputs & snapshots).
// Seamlessly coexists with Firebase Realtime Database for fallback.

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export class P2PTransport {
  constructor(roomService, isHost, myUid) {
    this.roomService = roomService;
    this.isHost = isHost;
    this.myUid = myUid;

    // Host: peerUid -> RTCPeerConnection
    // Guest: 'host' -> RTCPeerConnection
    this.peers = new Map();
    // Host: peerUid -> RTCDataChannel
    // Guest: 'host' -> RTCDataChannel
    this.channels = new Map();

    // In-flight ICE candidate queues until remoteDescription is set
    this._pendingIce = new Map();

    this.onData = null; // (senderUid, data) => void
    this.onPeerConnected = null; // (peerUid) => void
    this.onPeerDisconnected = null; // (peerUid) => void

    this._processedSignals = new Set();
    this._unsubSignals = null;
    this._destroyed = false;
  }

  start() {
    this._unsubSignals = this.roomService.onSignalsForMe((signal) => {
      this._handleIncomingSignal(signal);
    });
  }

  destroy() {
    this._destroyed = true;
    if (this._unsubSignals) {
      this._unsubSignals();
      this._unsubSignals = null;
    }
    for (const dc of this.channels.values()) {
      try {
        dc.close();
      } catch (_) {}
    }
    for (const pc of this.peers.values()) {
      try {
        pc.close();
      } catch (_) {}
    }
    this.channels.clear();
    this.peers.clear();
    this._pendingIce.clear();
  }

  isPeerConnected(uid) {
    const key = this.isHost ? uid : "host";
    const dc = this.channels.get(key);
    return dc && dc.readyState === "open";
  }

  hasAnyP2PConnection() {
    for (const dc of this.channels.values()) {
      if (dc.readyState === "open") return true;
    }
    return false;
  }

  // Guest -> Host: sends player input over DataChannel if open
  sendToHost(payload) {
    const dc = this.channels.get("host");
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify(payload));
        return true;
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  // Host -> specific Guest
  sendToGuest(guestUid, payload) {
    const dc = this.channels.get(guestUid);
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify(payload));
        return true;
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  // Host -> All connected Guests over DataChannel
  // Returns number of peers successfully sent via P2P
  broadcast(payload) {
    let sentCount = 0;
    const msg = JSON.stringify(payload);
    for (const [uid, dc] of this.channels.entries()) {
      if (dc && dc.readyState === "open") {
        try {
          dc.send(msg);
          sentCount++;
        } catch (_) {}
      }
    }
    return sentCount;
  }

  // Host initiates WebRTC connection to newly detected guest
  async connectToGuest(guestUid) {
    if (!this.isHost || this.peers.has(guestUid) || this._destroyed) return;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peers.set(guestUid, pc);

    // Unordered, maxRetransmits: 0 = UDP behavior for real-time gaming
    const dc = pc.createDataChannel("game", {
      ordered: false,
      maxRetransmits: 0,
    });
    this._setupDataChannel(guestUid, dc);

    pc.onicecandidate = (e) => {
      if (e.candidate && !this._destroyed) {
        this.roomService.sendSignal(guestUid, {
          type: "ice",
          candidate: e.candidate.toJSON(),
        }).catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this._cleanupPeer(guestUid);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.roomService.sendSignal(guestUid, {
        type: "offer",
        sdp: offer.sdp,
      });
    } catch (err) {
      console.warn(`[P2P] Failed to create offer for ${guestUid}:`, err);
      this._cleanupPeer(guestUid);
    }
  }

  async _handleIncomingSignal(signal) {
    if (!signal || this._destroyed) return;
    const signalId = signal.signalKey || `${signal.senderUid}_${signal.t}_${signal.type}`;
    if (this._processedSignals.has(signalId)) return;
    this._processedSignals.add(signalId);

    const senderUid = signal.senderUid;

    if (this.isHost) {
      // Host receives answer or ice from guest
      const pc = this.peers.get(senderUid);
      if (!pc) return;

      if (signal.type === "answer" && signal.sdp) {
        try {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp }));
            this._flushPendingIce(senderUid, pc);
          }
        } catch (err) {
          console.warn(`[P2P] Failed to set remote answer from ${senderUid}:`, err);
        }
      } else if (signal.type === "ice" && signal.candidate) {
        this._addOrQueueIce(senderUid, pc, signal.candidate);
      }
    } else {
      // Guest receives offer or ice from host
      if (signal.type === "offer" && signal.sdp) {
        let pc = this.peers.get("host");
        if (pc) {
          try {
            pc.close();
          } catch (_) {}
          this.peers.delete("host");
        }

        pc = new RTCPeerConnection(RTC_CONFIG);
        this.peers.set("host", pc);

        pc.ondatachannel = (e) => {
          this._setupDataChannel("host", e.channel);
        };

        pc.onicecandidate = (e) => {
          if (e.candidate && !this._destroyed) {
            this.roomService.sendSignal(senderUid, {
              type: "ice",
              candidate: e.candidate.toJSON(),
            }).catch(() => {});
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            this._cleanupPeer("host");
          }
        };

        try {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp }));
          this._flushPendingIce("host", pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await this.roomService.sendSignal(senderUid, {
            type: "answer",
            sdp: answer.sdp,
          });
        } catch (err) {
          console.warn("[P2P] Failed to answer host offer:", err);
          this._cleanupPeer("host");
        }
      } else if (signal.type === "ice" && signal.candidate) {
        const pc = this.peers.get("host");
        if (pc) {
          this._addOrQueueIce("host", pc, signal.candidate);
        } else {
          this._queueIce("host", signal.candidate);
        }
      }
    }
  }

  _setupDataChannel(peerKey, dc) {
    this.channels.set(peerKey, dc);

    dc.onopen = () => {
      console.log(`[P2P] DataChannel opened with ${peerKey}`);
      if (this.onPeerConnected) this.onPeerConnected(peerKey);
    };

    dc.onclose = () => {
      console.log(`[P2P] DataChannel closed with ${peerKey}`);
      this.channels.delete(peerKey);
      if (this.onPeerDisconnected) this.onPeerDisconnected(peerKey);
    };

    dc.onerror = (err) => {
      console.warn(`[P2P] DataChannel error with ${peerKey}:`, err);
    };

    dc.onmessage = (event) => {
      if (!this.onData || !event.data) return;
      try {
        const parsed = JSON.parse(event.data);
        this.onData(peerKey, parsed);
      } catch (err) {
        console.warn("[P2P] Failed to parse message:", err);
      }
    };
  }

  _addOrQueueIce(peerKey, pc, candidateData) {
    if (pc.remoteDescription && pc.remoteDescription.type) {
      pc.addIceCandidate(new RTCIceCandidate(candidateData)).catch(() => {});
    } else {
      this._queueIce(peerKey, candidateData);
    }
  }

  _queueIce(peerKey, candidateData) {
    if (!this._pendingIce.has(peerKey)) {
      this._pendingIce.set(peerKey, []);
    }
    this._pendingIce.get(peerKey).push(candidateData);
  }

  _flushPendingIce(peerKey, pc) {
    const list = this._pendingIce.get(peerKey);
    if (!list) return;
    for (const c of list) {
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    this._pendingIce.delete(peerKey);
  }

  _cleanupPeer(peerKey) {
    const pc = this.peers.get(peerKey);
    if (pc) {
      try {
        pc.close();
      } catch (_) {}
      this.peers.delete(peerKey);
    }
    const dc = this.channels.get(peerKey);
    if (dc) {
      try {
        dc.close();
      } catch (_) {}
      this.channels.delete(peerKey);
    }
    this._pendingIce.delete(peerKey);
  }
}
