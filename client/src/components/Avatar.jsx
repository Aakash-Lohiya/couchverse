import { initials } from '../lib/api.js';

const palette = ['#8b5cf6', '#06b6d4', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#84cc16'];
const hue = (s = '') => palette[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];

/**
 * Profile picture with initials fallback. Hovering shows @username.
 */
export default function Avatar({ user, size = 36, showTooltip = true, className = '', ring = false }) {
  if (!user) return null;
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38), background: user.avatar ? 'transparent' : hue(user.username || user.displayName) };
  return (
    <span className={`avatar ${ring ? 'avatar-ring' : ''} ${className}`} style={style} title={showTooltip && user.username ? `@${user.username}` : undefined}>
      {user.avatar ? <img src={user.avatar} alt={user.displayName} /> : initials(user.displayName)}
    </span>
  );
}
