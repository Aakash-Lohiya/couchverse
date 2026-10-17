import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import { Users, publicUser } from './db.js';

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const ALLOW_DEV_LOGIN =
  process.env.ALLOW_DEV_LOGIN === 'true' || (!GOOGLE_CLIENT_ID && process.env.ALLOW_DEV_LOGIN !== 'false');
const JWT_SECRET = process.env.JWT_SECRET || 'couchverse-dev-secret-change-me';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 90);

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

export function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.sub;
  } catch {
    return null;
  }
}

/** Express middleware: requires a Bearer token and loads req.user. */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token && verifyToken(token);
  const user = userId && (await Users.byId(userId).catch(() => null));
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

/** Verify a Google ID token and return the normalized identity. */
export async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new Error('Google sign-in is not configured (GOOGLE_CLIENT_ID missing)');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  return { sub: p.sub, email: p.email, name: p.name, picture: p.picture };
}

/** Find or create the user for an identity; returns { user, isNew }. */
export async function upsertIdentity({ sub, email, name, picture }) {
  let user = await Users.byGoogleSub(sub);
  if (user) return { user, isNew: false };
  if (email) {
    user = await Users.byEmail(email);
    if (user) return { user, isNew: false };
  }
  user = await Users.create({ id: randomUUID(), googleSub: sub, email, displayName: name || 'New viewer', avatar: picture });
  return { user, isNew: true };
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function sessionPayload(user) {
  return {
    token: signToken(user),
    user: publicUser(user),
    needsProfile: !user.username,
    usernameChanged: !!user.username_changed,
  };
}
