import { io } from 'socket.io-client';
import { SERVER_URL, getToken } from './api.js';

let socket = null;
let socketToken = null;

/** Singleton socket bound to the current auth token. */
export function getSocket() {
  const token = getToken();
  if (socket && socketToken === token) return socket;
  if (socket) socket.disconnect();
  socketToken = token;
  socket = io(SERVER_URL || undefined, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 300,
    reconnectionDelayMax: 3000,
    timeout: 8000,
  });
  return socket;
}

export function dropSocket() {
  if (socket) socket.disconnect();
  socket = null;
  socketToken = null;
}

/** Promise-style emit with ack. */
export function emitAck(sock, event, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
    sock.emit(event, payload, (res) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}
