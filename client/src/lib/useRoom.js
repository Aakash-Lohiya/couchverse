import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket, emitAck } from './socket.js';

const MAX_CHAT = 300;

/**
 * Owns the socket lifecycle for one room: join, snapshot, live updates,
 * rejoin on reconnect. Playback state is forwarded to `handlersRef.current.onPlaybackState`
 * so the SyncController (which lives with the player) can apply it instantly.
 */
export function useRoom({ code, passcode, handlersRef }) {
  const [status, setStatus] = useState('connecting'); // connecting | joined | needsPasscode | error | closed | superseded
  const [error, setError] = useState('');
  const [room, setRoom] = useState(null);
  const [settings, setSettings] = useState({});
  const [members, setMembers] = useState([]);
  const [hostId, setHostId] = useState(null);
  const [me, setMe] = useState(null);
  const [friends, setFriends] = useState(() => new Set());
  const [chat, setChat] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [polls, setPolls] = useState([]);
  const [queue, setQueue] = useState([]);
  const [media, setMedia] = useState(null);
  const [playback, setPlayback] = useState(null);
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState({});
  const [roomStats, setRoomStats] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const joinedOnce = useRef(false);

  const pushChat = useCallback((m) => setChat((c) => [...c.slice(-MAX_CHAT), m]), []);

  useEffect(() => {
    const s = getSocket();
    socketRef.current = s;
    let alive = true;

    const applySnapshot = (snap) => {
      setRoom(snap.room);
      setSettings(snap.settings);
      setMembers(snap.members);
      setHostId(snap.room.hostId);
      setMe(snap.me);
      setFriends(new Set(snap.friends || []));
      setChat(snap.chat);
      setReactions(snap.reactions);
      setPolls(snap.polls);
      setQueue(snap.queue);
      setMedia(snap.media);
      setPlayback(snap.state);
      setHeld(!!snap.heldByBuffering);
      handlersRef.current?.onSnapshot?.(snap);
      handlersRef.current?.onPlaybackState?.({ ...snap.state, replay: true });
    };

    const join = async () => {
      try {
        const res = await emitAck(s, 'room:join', { code, passcode });
        if (!alive) return;
        if (res.error) {
          setStatus(res.needsPasscode ? 'needsPasscode' : 'error');
          setError(res.error);
          return;
        }
        applySnapshot(res.snapshot);
        setStatus('joined');
        joinedOnce.current = true;
      } catch (e) {
        if (alive) {
          setStatus('error');
          setError(e.message);
        }
      }
    };

    const onConnect = () => {
      setConnected(true);
      if (joinedOnce.current) pushChat({ id: `sys-${Date.now()}`, kind: 'system', text: 'Reconnected, resyncing…', at: Date.now() });
      join();
    };
    const onDisconnect = () => {
      setConnected(false);
      pushChat({ id: `sys-${Date.now()}`, kind: 'system', text: 'Connection lost, reconnecting…', at: Date.now() });
    };

    const handlers = {
      'room:members': ({ members, hostId }) => {
        setMembers(members);
        setHostId(hostId);
      },
      'room:host': ({ hostId }) => setHostId(hostId),
      'room:system': (m) => pushChat({ ...m, id: `sys-${m.at}-${Math.random()}`, kind: 'system', subkind: m.kind }),
      'room:settings': ({ settings }) => setSettings(settings),
      'room:closed': ({ reason }) => {
        setStatus('closed');
        setError(reason);
      },
      'room:superseded': () => setStatus('superseded'),
      'room:hold': ({ held }) => setHeld(held),
      'room:stats': (st) => setRoomStats(st),
      'playback:state': (st) => {
        setPlayback(st);
        handlersRef.current?.onPlaybackState?.(st);
      },
      'media:change': ({ media }) => {
        setMedia(media);
        setReactions([]);
      },
      'queue:update': ({ queue }) => setQueue(queue),
      'chat:message': (m) => {
        pushChat(m);
        handlersRef.current?.onChat?.(m);
      },
      reaction: (r) => {
        setReactions((x) => [...x.slice(-500), r]);
        handlersRef.current?.onReaction?.(r);
      },
      'poll:update': ({ poll }) =>
        setPolls((ps) => {
          const i = ps.findIndex((p) => p.id === poll.id);
          if (i < 0) return [...ps, poll];
          const n = [...ps];
          n[i] = poll;
          return n;
        }),
      'member:buffering': ({ userId, buffering }) => setMembers((ms) => ms.map((m) => (m.id === userId ? { ...m, buffering } : m))),
      typing: ({ userId, typing }) => setTyping((t) => ({ ...t, [userId]: typing ? Date.now() : 0 })),
    };

    for (const [e, f] of Object.entries(handlers)) s.on(e, f);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    if (s.connected) onConnect();

    return () => {
      alive = false;
      for (const [e, f] of Object.entries(handlers)) s.off(e, f);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.emit('room:leave');
    };
  }, [code, passcode]);

  const s = () => socketRef.current;
  const actions = {
    control: (ctl) => s()?.emit('playback:control', ctl),
    setMedia: (media, autoplay = true) => emitAck(s(), 'playback:setMedia', { media, autoplay }),
    report: (stats) => s()?.emit('playback:report', stats),
    setBuffering: (buffering) => s()?.emit('member:buffering', { buffering }),
    chat: (text, extra = {}) => s()?.emit('chat:send', { text, ...extra }),
    react: (emoji, mediaPos) => s()?.emit('reaction:send', { emoji, mediaPos }),
    transferHost: (userId) => emitAck(s(), 'host:transfer', { userId }),
    endRoom: () => emitAck(s(), 'room:end', {}),
    updateSettings: (patch) => s()?.emit('room:settings', patch),
    queueAdd: (item) => emitAck(s(), 'queue:add', item),
    queueRemove: (id) => s()?.emit('queue:remove', { id }),
    queueMove: (id, toIndex) => s()?.emit('queue:move', { id, toIndex }),
    queueVote: (id) => s()?.emit('queue:vote', { id }),
    queuePlay: (id) => emitAck(s(), 'queue:play', { id }),
    pollCreate: (p) => emitAck(s(), 'poll:create', p),
    pollVote: (pollId, option) => s()?.emit('poll:vote', { pollId, option }),
    pollClose: (pollId) => s()?.emit('poll:close', { pollId }),
    typing: (t) => s()?.emit('typing', { typing: t }),
    timePing: (t0) => new Promise((resolve, reject) => {
      const sock = s();
      if (!sock?.connected) return reject(new Error('offline'));
      sock.emit('time:ping', t0, (t1) => resolve(t1));
    }),
  };

  return { status, error, room, settings, members, hostId, me, friends, chat, reactions, polls, queue, media, playback, held, typing, roomStats, connected, actions, socket: socketRef };
}
