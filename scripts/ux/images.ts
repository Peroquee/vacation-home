/**
 * Pictures for the UX review seed (GitLab #132): painted stand-ins for
 * property photos and a till receipt, drawn as SVG and rendered by sharp, so
 * the review needs no stock photos (and no licences) in the repository.
 * They are not meant to look like photographs, only to fill the places real
 * photos take, at realistic sizes and aspect ratios.
 */
import sharp from "sharp";

type Scene = "lake" | "cabin" | "living" | "bedroom" | "kitchen" | "terrace";

const W = 1600;
const H = 1067;

function sky(top: string, bottom: string): string {
  return `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
  </linearGradient></defs><rect width="${W}" height="${H}" fill="url(#sky)"/>`;
}

function tree(x: number, y: number, h: number, colour: string): string {
  return `<rect x="${x - 6}" y="${y - h * 0.25}" width="12" height="${h * 0.25}" fill="#4a3426"/>
    <polygon points="${x},${y - h} ${x - h * 0.28},${y - h * 0.2} ${x + h * 0.28},${y - h * 0.2}" fill="${colour}"/>`;
}

function room(wall: string, floor: string, inner: string): string {
  return `<rect width="${W}" height="${H}" fill="${wall}"/>
    <rect y="${H * 0.72}" width="${W}" height="${H * 0.28}" fill="${floor}"/>
    <rect x="${W * 0.58}" y="${H * 0.14}" width="${W * 0.3}" height="${H * 0.42}" fill="#cfe3ee" stroke="#f4f1ea" stroke-width="18"/>
    <polygon points="${W * 0.58},${H * 0.45} ${W * 0.7},${H * 0.33} ${W * 0.88},${H * 0.42} ${W * 0.88},${H * 0.56} ${W * 0.58},${H * 0.56}" fill="#7fa37a"/>
    ${inner}`;
}

const SCENES: Record<Scene, string> = {
  lake: `${sky("#8fb8d8", "#e8eef0")}
    <ellipse cx="1250" cy="230" rx="70" ry="70" fill="#fff6d8" opacity="0.8"/>
    <path d="M0 620 Q300 470 620 560 T1600 520 V1067 H0Z" fill="#7d9a6a"/>
    <rect y="700" width="${W}" height="367" fill="#4f7f96"/>
    <path d="M0 700 H1600 V720 H0Z" fill="#9cc0cf" opacity="0.6"/>
    <rect x="560" y="520" width="360" height="180" fill="#efe6d4"/>
    <polygon points="540,525 740,410 940,525" fill="#9a4a32"/>
    <rect x="620" y="580" width="60" height="70" fill="#5b6b74"/><rect x="780" y="580" width="90" height="120" fill="#6b4a32"/>
    ${tree(420, 700, 260, "#3f6b45")}${tree(1040, 700, 300, "#355c3c")}${tree(1160, 700, 220, "#46744b")}`,
  cabin: `${sky("#6f93b8", "#dfe8ef")}
    <polygon points="0,640 380,220 700,560 1000,180 1600,640" fill="#8a96a3"/>
    <polygon points="300,310 380,220 460,310 420,300 380,330 340,300" fill="#f6f7f8"/>
    <polygon points="920,270 1000,180 1080,270 1040,262 1000,292 960,262" fill="#f6f7f8"/>
    <rect y="640" width="${W}" height="427" fill="#6f8f4e"/>
    <rect x="600" y="560" width="420" height="230" fill="#7a5235"/>
    <polygon points="570,570 810,430 1050,570" fill="#3d3a37"/>
    <rect x="660" y="620" width="80" height="80" fill="#f2d48a"/><rect x="880" y="640" width="90" height="150" fill="#4a3020"/>
    ${tree(300, 820, 340, "#2f5236")}${tree(1250, 800, 300, "#2c4c33")}${tree(1400, 840, 380, "#365a3d")}`,
  living: room(
    "#e9e2d6",
    "#b08a63",
    `<rect x="160" y="560" width="620" height="200" rx="40" fill="#5c7a8a"/>
     <rect x="200" y="500" width="540" height="110" rx="30" fill="#6d8c9b"/>
     <rect x="860" y="700" width="300" height="90" fill="#7a5235"/>
     <rect x="240" y="180" width="220" height="160" fill="#c9a66b" stroke="#6b4a32" stroke-width="10"/>`,
  ),
  bedroom: room(
    "#dfe5e3",
    "#a98663",
    `<rect x="140" y="600" width="760" height="220" fill="#f7f4ee"/>
     <rect x="140" y="420" width="40" height="400" fill="#6b4a32"/>
     <rect x="200" y="560" width="200" height="70" rx="20" fill="#ffffff"/>
     <rect x="440" y="560" width="200" height="70" rx="20" fill="#ffffff"/>
     <rect x="140" y="680" width="760" height="140" fill="#8aa1b1"/>`,
  ),
  kitchen: room(
    "#eef0ea",
    "#8f8a80",
    `<rect x="80" y="520" width="900" height="250" fill="#f7f7f2"/>
     <rect x="80" y="500" width="900" height="30" fill="#5e5a55"/>
     <rect x="80" y="180" width="420" height="180" fill="#f7f7f2" stroke="#d6d3cc" stroke-width="6"/>
     <circle cx="760" cy="470" r="26" fill="#b5523b"/><circle cx="830" cy="478" r="20" fill="#d9a441"/>`,
  ),
  terrace: `${sky("#9cc3dd", "#f0ede4")}
    <rect y="560" width="${W}" height="200" fill="#5f8fa6"/>
    <path d="M0 560 Q400 480 800 540 T1600 520 V560 H0Z" fill="#7d9a6a"/>
    <rect y="740" width="${W}" height="327" fill="#a7825d"/>
    ${Array.from({ length: 16 }, (_, i) => `<rect x="${i * 100}" y="740" width="4" height="327" fill="#8c6a48"/>`).join("")}
    <rect x="520" y="800" width="480" height="24" fill="#6b4a32"/>
    <rect x="560" y="824" width="18" height="140" fill="#6b4a32"/><rect x="940" y="824" width="18" height="140" fill="#6b4a32"/>
    <rect x="300" y="820" width="140" height="160" rx="16" fill="#e8e1d4"/><rect x="1080" y="820" width="140" height="160" rx="16" fill="#e8e1d4"/>`,
};

/** A JPEG standing in for a property photo, 1600x1067 like a camera's 3:2. */
export async function scenePhoto(scene: Scene): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${SCENES[scene]}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

export const LAKE_SCENES: Scene[] = ["lake", "terrace", "living", "bedroom", "kitchen"];
export const CABIN_SCENES: Scene[] = ["cabin", "living", "bedroom", "kitchen"];

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A photographed till receipt, as a phone would upload it. */
export async function receiptPhoto(shop: string, lines: [string, string][]): Promise<Buffer> {
  const width = 700;
  const height = 260 + lines.length * 44 + 120;
  const rows = lines
    .map(
      ([item, amount], i) =>
        `<text x="60" y="${240 + i * 44}">${escapeXml(item)}</text>
         <text x="${width - 60}" y="${240 + i * 44}" text-anchor="end">${escapeXml(amount)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width + 120}" height="${height + 120}">
    <rect width="100%" height="100%" fill="#5a5f63"/>
    <g transform="translate(60 60) rotate(-1.5 ${width / 2} ${height / 2})">
      <rect width="${width}" height="${height}" fill="#fbfaf6"/>
      <g font-family="DejaVu Sans Mono, monospace" font-size="30" fill="#2a2a2a">
        <text x="${width / 2}" y="110" text-anchor="middle" font-size="40" font-weight="bold">${escapeXml(shop)}</text>
        <text x="${width / 2}" y="160" text-anchor="middle" font-size="24">Kassenbon</text>
        ${rows}
        <line x1="60" x2="${width - 60}" y1="${240 + lines.length * 44 - 20}" y2="${240 + lines.length * 44 - 20}" stroke="#2a2a2a" stroke-dasharray="6 6"/>
      </g>
    </g></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}
