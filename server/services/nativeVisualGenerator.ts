import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CinematicStyle,
  NativeVisualDiagramType,
  TechAsset,
} from '../../shared/types.js';
import type { AssetLibrary } from '../store/assetLibrary.js';

interface StyleColors {
  bg1: string;
  bg2: string;
  accent: string;
  secondary: string;
  cardBg: string;
  border: string;
}

const STYLE_COLOR_MAP: Record<CinematicStyle, StyleColors> = {
  'Neon Lab': {
    bg1: '#061124',
    bg2: '#130b29',
    accent: '#22d3ee',
    secondary: '#a855f7',
    cardBg: '#0c1528',
    border: '#1e3a5f',
  },
  'Anamorphic Studio': {
    bg1: '#0b0e19',
    bg2: '#171326',
    accent: '#6366f1',
    secondary: '#38bdf8',
    cardBg: '#11162a',
    border: '#2e365f',
  },
  'Blueprint Isometric': {
    bg1: '#04182b',
    bg2: '#082542',
    accent: '#38bdf8',
    secondary: '#34d399',
    cardBg: '#09223b',
    border: '#1e4e79',
  },
  'Editorial Documentary': {
    bg1: '#14110f',
    bg2: '#231b17',
    accent: '#f59e0b',
    secondary: '#fb7185',
    cardBg: '#1c1714',
    border: '#4d3a2c',
  },
  'Quantum Noir': {
    bg1: '#08080e',
    bg2: '#180d22',
    accent: '#ec4899',
    secondary: '#818cf8',
    cardBg: '#120f1c',
    border: '#432551',
  },
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateLabel(str: string, maxLen: number): string {
  const clean = str.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

export function inferDiagramType(
  prompt: string,
  requested?: NativeVisualDiagramType
): Exclude<NativeVisualDiagramType, 'auto'> {
  if (requested && requested !== 'auto') return requested;
  const lower = prompt.toLowerCase();
  if (/\b(vs\.?|versus|compare|comparison|tradeoff|before\s*&\s*after|difference)\b/.test(lower)) {
    return 'comparison';
  }
  if (/\b(gpu|rack|chip|silicon|hardware|cluster|server|node|cloud|region|vpc|datacenter)\b/.test(lower)) {
    return 'hardware';
  }
  if (/\b(\d+%|\d+ms|\d+x|metric|benchmark|throughput|latency|kpi|stat|infographic|growth)\b/.test(lower)) {
    return 'infographic';
  }
  if (/\b(step|pipeline|flow|sequence|workflow|stage|request|lifecycle|protocol|handshake)\b/.test(lower)) {
    return 'flow';
  }
  return 'architecture';
}

function extractPromptNodes(prompt: string, title?: string, keyPoints: string[] = []): string[] {
  const candidates: string[] = [];

  for (const kp of keyPoints) {
    const cleaned = kp.replace(/^[-*•\d.)\s]+/, '').trim();
    if (cleaned.length >= 2) candidates.push(cleaned);
  }

  // Split prompt phrases by common delimiters
  const parts = prompt
    .replace(/^(cinematic|create|generate|show|illustrate|explain|scene\s+showing)\s+/i, '')
    .split(/[,;→>|/]|\band\b|\bvs\.?\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && p.length <= 44);

  for (const p of parts) {
    if (!candidates.some((c) => c.toLowerCase() === p.toLowerCase())) {
      candidates.push(p);
    }
  }

  if (candidates.length < 3 && title) {
    const titleWords = title
      .replace(/^\d+\.\d+\s*/, '')
      .split(/[:\-–—]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    for (const tw of titleWords) {
      if (!candidates.includes(tw)) candidates.push(tw);
    }
  }

  // Extract distinct domain keywords if still sparse
  if (candidates.length < 3) {
    const tokens = `${title || ''} ${prompt}`
      .replace(/[^a-zA-Z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !['with', 'that', 'this', 'from', 'into', 'scene', 'visual'].includes(w.toLowerCase()));
    for (const tok of tokens) {
      if (!candidates.some((c) => c.toLowerCase().includes(tok.toLowerCase()))) {
        candidates.push(tok);
      }
      if (candidates.length >= 4) break;
    }
  }

  while (candidates.length < 4) {
    candidates.push(
      candidates.length === 0
        ? truncateLabel(title || prompt, 24)
        : `Stage ${candidates.length + 1}`
    );
  }

  return candidates.slice(0, 5).map((c) => truncateLabel(c, 26));
}

export function buildNativeDiagramSvg(params: {
  prompt: string;
  title?: string;
  keyPoints?: string[];
  style?: CinematicStyle;
  diagramType?: NativeVisualDiagramType;
}): {
  svg: string;
  diagramType: Exclude<NativeVisualDiagramType, 'auto'>;
  labels: string[];
} {
  const style = params.style || 'Neon Lab';
  const colors = STYLE_COLOR_MAP[style] || STYLE_COLOR_MAP['Neon Lab'];
  const diagramType = inferDiagramType(`${params.title || ''} ${params.prompt}`, params.diagramType);
  const labels = extractPromptNodes(params.prompt, params.title, params.keyPoints || []);
  const headerTitle = escapeXml(truncateLabel(params.title || params.prompt, 54));
  const subtitle = escapeXml(truncateLabel(params.prompt, 84));

  let bodySvg = '';

  if (diagramType === 'comparison') {
    const vsParts = params.prompt.split(/\bvs\.?\b|\bversus\b|\bcompared\s+to\b/i);
    const leftTitle = escapeXml(truncateLabel(vsParts[0] || labels[0] || 'Approach A', 24));
    const rightTitle = escapeXml(truncateLabel(vsParts[1] || labels[1] || 'Approach B', 24));
    const leftBullets = (params.keyPoints && params.keyPoints.length >= 2 ? params.keyPoints.slice(0, 2) : [labels[0], labels[2]]).map(
      (b) => escapeXml(truncateLabel(b, 32))
    );
    const rightBullets = (params.keyPoints && params.keyPoints.length >= 4 ? params.keyPoints.slice(2, 4) : [labels[1], labels[3]]).map(
      (b) => escapeXml(truncateLabel(b, 32))
    );

    bodySvg = `
      <rect x="64" y="128" width="382" height="300" rx="16" fill="${colors.cardBg}" stroke="${colors.accent}" stroke-width="2.5"/>
      <rect x="64" y="128" width="382" height="48" rx="16" fill="${colors.accent}" fill-opacity="0.18"/>
      <text x="255" y="159" text-anchor="middle" fill="${colors.accent}" font-family="Inter, sans-serif" font-size="18" font-weight="700">${leftTitle}</text>
      <circle cx="96" cy="222" r="6" fill="${colors.accent}"/>
      <text x="114" y="227" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="15">${leftBullets[0] || 'Primary Path'}</text>
      <circle cx="96" cy="274" r="6" fill="${colors.accent}"/>
      <text x="114" y="279" fill="#cbd5e1" font-family="Inter, sans-serif" font-size="15">${leftBullets[1] || 'Baseline Profile'}</text>
      <rect x="92" y="330" width="326" height="66" rx="10" fill="#050914" stroke="${colors.border}"/>
      <text x="255" y="368" text-anchor="middle" fill="${colors.accent}" font-family="monospace" font-size="13">PATH_A • ${leftTitle}</text>

      <circle cx="480" cy="278" r="24" fill="#090d16" stroke="${colors.secondary}" stroke-width="2.5"/>
      <text x="480" y="284" text-anchor="middle" fill="#f8fafc" font-family="Inter, sans-serif" font-size="14" font-weight="700">VS</text>

      <rect x="514" y="128" width="382" height="300" rx="16" fill="${colors.cardBg}" stroke="${colors.secondary}" stroke-width="2.5"/>
      <rect x="514" y="128" width="382" height="48" rx="16" fill="${colors.secondary}" fill-opacity="0.18"/>
      <text x="705" y="159" text-anchor="middle" fill="${colors.secondary}" font-family="Inter, sans-serif" font-size="18" font-weight="700">${rightTitle}</text>
      <circle cx="546" cy="222" r="6" fill="${colors.secondary}"/>
      <text x="564" y="227" fill="#e2e8f0" font-family="Inter, sans-serif" font-size="15">${rightBullets[0] || 'Target Path'}</text>
      <circle cx="546" cy="274" r="6" fill="${colors.secondary}"/>
      <text x="564" y="279" fill="#cbd5e1" font-family="Inter, sans-serif" font-size="15">${rightBullets[1] || 'Optimized Profile'}</text>
      <rect x="542" y="330" width="326" height="66" rx="10" fill="#050914" stroke="${colors.border}"/>
      <text x="705" y="368" text-anchor="middle" fill="${colors.secondary}" font-family="monospace" font-size="13">PATH_B • ${rightTitle}</text>
    `;
  } else if (diagramType === 'flow') {
    const count = Math.min(4, labels.length);
    const boxW = 186;
    const gap = 36;
    const startX = (960 - (count * boxW + (count - 1) * gap)) / 2;
    bodySvg = labels
      .slice(0, count)
      .map((lbl, idx) => {
        const x = startX + idx * (boxW + gap);
        const y = 188;
        const stroke = idx % 2 === 0 ? colors.accent : colors.secondary;
        const arrow =
          idx < count - 1
            ? `<line x1="${x + boxW}" y1="${y + 72}" x2="${x + boxW + gap - 8}" y2="${y + 72}" stroke="${colors.accent}" stroke-width="3"/>
               <polygon points="${x + boxW + gap - 10},${y + 64} ${x + boxW + gap},${y + 72} ${x + boxW + gap - 10},${y + 80}" fill="${colors.accent}"/>`
            : '';
        return `
          <rect x="${x}" y="${y}" width="${boxW}" height="144" rx="14" fill="${colors.cardBg}" stroke="${stroke}" stroke-width="2.5"/>
          <circle cx="${x + 28}" cy="${y + 30}" r="14" fill="${stroke}" fill-opacity="0.2" stroke="${stroke}"/>
          <text x="${x + 28}" y="${y + 35}" text-anchor="middle" fill="${stroke}" font-family="monospace" font-size="13" font-weight="700">0${idx + 1}</text>
          <text x="${x + boxW / 2}" y="${y + 84}" text-anchor="middle" fill="#f8fafc" font-family="Inter, sans-serif" font-size="15" font-weight="600">${escapeXml(truncateLabel(lbl, 20))}</text>
          <rect x="${x + 20}" y="${y + 106}" width="${boxW - 40}" height="8" rx="4" fill="${stroke}" fill-opacity="0.35"/>
          ${arrow}
        `;
      })
      .join('');
  } else if (diagramType === 'hardware') {
    const cardW = 240;
    const positions = [96, 360, 624];
    bodySvg = positions
      .map((x, idx) => {
        const lbl = escapeXml(truncateLabel(labels[idx] || `Unit ${idx + 1}`, 22));
        const stroke = idx === 1 ? colors.secondary : colors.accent;
        const link =
          idx < 2
            ? `<line x1="${x + cardW}" y1="278" x2="${positions[idx + 1]}" y2="278" stroke="${colors.accent}" stroke-width="3" stroke-dasharray="6 4"/>`
            : '';
        const blades = [0, 1, 2, 3]
          .map(
            (b) => `
            <rect x="${x + 20}" y="${196 + b * 44}" width="${cardW - 40}" height="32" rx="6" fill="#060b16" stroke="${colors.border}"/>
            <circle cx="${x + 36}" cy="${212 + b * 44}" r="4" fill="${stroke}"/>
            <rect x="${x + 50}" y="${208 + b * 44}" width="110" height="8" rx="4" fill="${stroke}" fill-opacity="0.28"/>
          `
          )
          .join('');
        return `
          <rect x="${x}" y="132" width="${cardW}" height="280" rx="14" fill="${colors.cardBg}" stroke="${stroke}" stroke-width="2.5"/>
          <text x="${x + cardW / 2}" y="168" text-anchor="middle" fill="${stroke}" font-family="monospace" font-size="14" font-weight="700">${lbl}</text>
          ${blades}
          ${link}
        `;
      })
      .join('');
  } else if (diagramType === 'infographic') {
    const cards = labels.slice(0, 3);
    const cardW = 250;
    const xs = [72, 355, 638];
    bodySvg = xs
      .map((x, idx) => {
        const stroke = idx === 1 ? colors.secondary : colors.accent;
        const val = escapeXml(truncateLabel(cards[idx] || `Metric ${idx + 1}`, 22));
        const barH = 54 + ((idx * 29 + 35) % 85);
        return `
          <rect x="${x}" y="140" width="${cardW}" height="260" rx="16" fill="${colors.cardBg}" stroke="${stroke}" stroke-width="2"/>
          <text x="${x + 22}" y="176" fill="${stroke}" font-family="monospace" font-size="12" font-weight="700">SIGNAL 0${idx + 1}</text>
          <text x="${x + 22}" y="210" fill="#f8fafc" font-family="Inter, sans-serif" font-size="16" font-weight="700">${val}</text>
          <rect x="${x + 28}" y="${366 - barH}" width="44" height="${barH}" rx="6" fill="${stroke}" fill-opacity="0.85"/>
          <rect x="${x + 92}" y="${366 - Math.round(barH * 0.72)}" width="44" height="${Math.round(barH * 0.72)}" rx="6" fill="${colors.secondary}" fill-opacity="0.65"/>
          <rect x="${x + 156}" y="${366 - Math.round(barH * 0.9)}" width="44" height="${Math.round(barH * 0.9)}" rx="6" fill="${stroke}" fill-opacity="0.45"/>
        `;
      })
      .join('');
  } else {
    // Architecture topology
    const nodes = [
      { x: 110, y: 155, label: labels[0] || 'Ingress', color: colors.accent },
      { x: 110, y: 315, label: labels[1] || 'Context', color: colors.secondary },
      { x: 390, y: 235, label: labels[2] || 'Core Engine', color: colors.accent },
      { x: 670, y: 155, label: labels[3] || 'Pipeline', color: colors.secondary },
      { x: 670, y: 315, label: labels[4] || 'Output', color: colors.accent },
    ];
    const edges = [
      [0, 2],
      [1, 2],
      [2, 3],
      [2, 4],
    ];
    const edgesSvg = edges
      .map(([a, b]) => {
        const na = nodes[a];
        const nb = nodes[b];
        return `<line x1="${na.x + 95}" y1="${na.y + 38}" x2="${nb.x + 95}" y2="${nb.y + 38}" stroke="${colors.accent}" stroke-opacity="0.7" stroke-width="3"/>`;
      })
      .join('');
    const nodesSvg = nodes
      .map(
        (n) => `
        <rect x="${n.x}" y="${n.y}" width="190" height="76" rx="12" fill="${colors.cardBg}" stroke="${n.color}" stroke-width="2.5"/>
        <circle cx="${n.x + 24}" cy="${n.y + 38}" r="7" fill="${n.color}"/>
        <text x="${n.x + 42}" y="${n.y + 43}" fill="#f8fafc" font-family="Inter, sans-serif" font-size="14" font-weight="600">${escapeXml(truncateLabel(n.label, 18))}</text>
      `
      )
      .join('');
    bodySvg = edgesSvg + nodesSvg;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors.bg1}"/>
      <stop offset="100%" stop-color="${colors.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" fill="url(#bg)"/>
  <g stroke="${colors.accent}" stroke-opacity="0.12" stroke-width="1">
    <line x1="0" y1="135" x2="960" y2="135"/><line x1="0" y1="270" x2="960" y2="270"/><line x1="0" y1="405" x2="960" y2="405"/>
    <line x1="240" y1="0" x2="240" y2="540"/><line x1="480" y1="0" x2="480" y2="540"/><line x1="720" y1="0" x2="720" y2="540"/>
  </g>
  <rect x="44" y="28" width="872" height="68" rx="12" fill="#070a14" fill-opacity="0.88" stroke="${colors.border}"/>
  <text x="64" y="57" fill="#f8fafc" font-family="Inter, sans-serif" font-size="20" font-weight="700">${headerTitle}</text>
  <text x="64" y="80" fill="${colors.accent}" font-family="monospace" font-size="12">${diagramType.toUpperCase()} • ${subtitle}</text>
  ${bodySvg}
</svg>`;

  return { svg, diagramType, labels };
}

export async function generateNativeVisualAsset(params: {
  prompt: string;
  title?: string;
  keyPoints?: string[];
  style?: CinematicStyle;
  diagramType?: NativeVisualDiagramType;
  uploadsRootDir: string;
  assetLibrary: AssetLibrary;
}): Promise<{ asset: TechAsset; visualUrl: string; diagramType: Exclude<NativeVisualDiagramType, 'auto'> }> {
  const generatedDir = path.join(params.uploadsRootDir, 'generated');
  await fs.mkdir(generatedDir, { recursive: true });

  const built = buildNativeDiagramSvg({
    prompt: params.prompt,
    title: params.title,
    keyPoints: params.keyPoints,
    style: params.style,
    diagramType: params.diagramType,
  });

  const filename = `visual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.svg`;
  await fs.writeFile(path.join(generatedDir, filename), built.svg, 'utf-8');
  const visualUrl = `/uploads/generated/${filename}`;

  const category =
    built.diagramType === 'hardware' ? 'hardware' : 'architecture-diagram';
  const tags = Array.from(
    new Set(
      [
        'generated',
        built.diagramType,
        ...built.labels.flatMap((l) => l.toLowerCase().split(/\s+/)),
        ...(params.title || params.prompt).toLowerCase().split(/\s+/),
      ]
        .map((t) => t.replace(/[^a-z0-9_-]/g, ''))
        .filter((t) => t.length >= 2)
    )
  ).slice(0, 10);

  const asset = await params.assetLibrary.addAsset({
    name: truncateLabel(params.title || params.prompt, 64),
    category,
    sourceType: 'photos',
    mediaUrls: [visualUrl],
    description: params.prompt,
    technicalSpecs: `Native ${built.diagramType} SVG • ${built.labels.slice(0, 3).join(' • ')}`,
    tags,
  });

  return { asset, visualUrl, diagramType: built.diagramType };
}
