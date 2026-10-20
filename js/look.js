// Category colors and icons. Each category gets a color from a forest palette and a simple line icon,
// chosen by name for the built-in categories and by position for ones the household adds.

// Light-theme hues; dark mode lifts them in CSS via color-mix.
export const PALETTE = ['#B5472E', '#D9973A', '#5E8A45', '#2F7A72', '#7D3C5C', '#3F6E9E', '#A0623E', '#8A7A2E', '#5D6B7A', '#C46A7A', '#4E9A8B', '#6B5BA3'];

const BY_NAME = {
  housing: 0, groceries: 2, dining: 1, transport: 5, utilities: 7, subscriptions: 4, shopping: 9, health: 3,
  entertainment: 11, travel: 10, 'personal care': 9, 'gifts & giving': 4, 'fees & interest': 8, cash: 7,
  'debt payments': 0, 'transfers out': 8, other: 8, paycheck: 2, 'other income': 3,
};

export function catColor(cat, index = 0) {
  if (!cat) return '#8A8F87';
  const k = BY_NAME[cat.name?.toLowerCase()];
  return PALETTE[(k ?? (cat.sort ?? index)) % PALETTE.length];
}

const P = {
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/>',
  cart: '<path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  fork: '<path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v5M11 3v5a2 2 0 0 1-2 2M16 21V3c2 1.5 3 4 3 7s-1 4-3 4"/>',
  car: '<path d="M5 16h14M6.5 16l1.6-5.2A2 2 0 0 1 10 9.4h4a2 2 0 0 1 1.9 1.4l1.6 5.2M5 16v3h2v-2M19 16v3h-2v-2"/><circle cx="8" cy="16" r=".6"/><circle cx="16" cy="16" r=".6"/>',
  bolt: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
  repeat: '<path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/>',
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  ticket: '<path d="M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 1 0-4V4H4zM14 4v12"/>',
  plane: '<path d="M10 14 3 11l1-2 8 1 4-5a1.5 1.5 0 0 1 2 2l-3 5 1 8-2 1-3-7z"/>',
  sparkle: '<path d="M12 3c.5 4 2 5.5 6 6-4 .5-5.5 2-6 6-.5-4-2-5.5-6-6 4-.5 5.5-2 6-6zM18 16c.2 1.5.8 2.1 2 2.3-1.2.2-1.8.8-2 2.2-.2-1.4-.8-2-2-2.2 1.2-.2 1.8-.8 2-2.3z"/>',
  gift: '<path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3-2-5 1"/>',
  percent: '<path d="M6 18 18 6"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
  bill: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.2"/><path d="M6 10v4M18 10v4"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
  out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15zM5 19l7-7"/>',
  sprout: '<path d="M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-3.5 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5z"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
};
const ICON_BY_NAME = {
  housing: 'home', groceries: 'cart', dining: 'fork', transport: 'car', utilities: 'bolt', subscriptions: 'repeat',
  shopping: 'bag', health: 'heart', entertainment: 'ticket', travel: 'plane', 'personal care': 'sparkle',
  'gifts & giving': 'gift', 'fees & interest': 'percent', cash: 'bill', 'debt payments': 'card', 'transfers out': 'out',
  other: 'leaf', paycheck: 'sprout', 'other income': 'sprout',
};

export function icon(name, size = 20) {
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${P[name] || P.dot}</svg>`;
}

export function catIcon(cat, size = 20) {
  if (!cat) return icon('dot', size);
  return icon(ICON_BY_NAME[cat.name?.toLowerCase()] || (cat.kind === 'income' ? 'sprout' : 'leaf'), size);
}

// A colored icon badge for a category.
export function catBadge(cat, size = 36) {
  return `<span class="cat-badge" style="--c:${catColor(cat)};width:${size}px;height:${size}px">${catIcon(cat, Math.round(size * 0.55))}</span>`;
}

// Small ring gauge: share of budget used, colored by category; over budget shows a full ring in the alert color.
export function miniRing(pct, color, size = 44) {
  const r = 17, c = 2 * Math.PI * r;
  const over = pct > 1;
  const fill = Math.min(pct, 1);
  return `<svg class="mini-ring" viewBox="0 0 44 44" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="22" cy="22" r="${r}" class="mr-track"/>
    <circle cx="22" cy="22" r="${r}" class="mr-fill ${over ? 'mr-over' : ''}" style="--c:${color}" stroke-dasharray="${(c * fill).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 22 22)"/>
    <text x="22" y="26" text-anchor="middle" class="mr-text">${Math.round(pct * 100)}%</text>
  </svg>`;
}
