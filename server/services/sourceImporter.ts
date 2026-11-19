import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import type { ImportedSource, ImportedSourceSlide, TechAsset } from '../../shared/types.js';
import type { AssetLibrary } from '../store/assetLibrary.js';
import { parsePcmWavMono } from './voiceDsp.js';

const execFileAsync = promisify(execFile);

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function extractParagraphLinesFromDrawingXml(xml: string): string[] {
  const lines: string[] = [];
  const pMatches = xml.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) || [];
  for (const pBlock of pMatches) {
    const tMatches = pBlock.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) || [];
    const text = tMatches
      .map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      lines.push(text);
    }
  }
  if (lines.length === 0) {
    const fallbackT = xml.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) || [];
    for (const t of fallbackT) {
      const cleaned = decodeXmlEntities(t.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (cleaned) lines.push(cleaned);
    }
  }
  return lines;
}

interface SlideRelationship {
  id: string;
  type: string;
  target: string;
}

function parseRelsXml(xml: string): SlideRelationship[] {
  const rels: SlideRelationship[] = [];
  const tags = xml.match(/<Relationship\b[^>]*\/?>/gi) || [];
  for (const tag of tags) {
    const id = tag.match(/\bId="([^"]+)"/i)?.[1] || '';
    const type = tag.match(/\bType="([^"]+)"/i)?.[1] || '';
    const target = tag.match(/\bTarget="([^"]+)"/i)?.[1] || '';
    if (target) {
      rels.push({ id, type, target });
    }
  }
  return rels;
}

function resolvePptxRelativeTarget(baseDir: string, target: string): string {
  const clean = target.replace(/\\/g, '/');
  if (clean.startsWith('/')) {
    return clean.slice(1);
  }
  return path.posix.normalize(path.posix.join(baseDir, clean));
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

export async function parseAndImportPptx(params: {
  buffer: Buffer;
  filename: string;
  name?: string;
  uploadsSourcesDir: string;
  assetLibrary?: AssetLibrary;
}): Promise<Omit<ImportedSource, 'id' | 'createdAt'>> {
  const zip = await JSZip.loadAsync(params.buffer);
  await fs.mkdir(params.uploadsSourcesDir, { recursive: true });

  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
    .sort((a, b) => {
      const na = Number.parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      const nb = Number.parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      return na - nb;
    });

  if (slideFiles.length === 0) {
    throw new Error('No slides found inside PPTX archive (expected ppt/slides/slide*.xml).');
  }

  const savedMediaMap = new Map<string, string>(); // zipPath -> /uploads/sources/...
  const createdAssets: TechAsset[] = [];

  const saveZipMediaFile = async (zipPath: string, slideTitleHint: string): Promise<string | null> => {
    if (savedMediaMap.has(zipPath)) {
      return savedMediaMap.get(zipPath)!;
    }
    const entry = zip.file(zipPath);
    if (!entry) return null;
    const ext = path.extname(zipPath).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return null;

    const rawBytes = await entry.async('nodebuffer');
    if (rawBytes.length === 0) return null;

    const outName = `pptx-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
    await fs.writeFile(path.join(params.uploadsSourcesDir, outName), rawBytes);
    const url = `/uploads/sources/${outName}`;
    savedMediaMap.set(zipPath, url);

    if (params.assetLibrary && (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp')) {
      const asset = await params.assetLibrary.addAsset({
        name: `${slideTitleHint} (Slide Visual)`,
        category: 'architecture-diagram',
        sourceType: 'photos',
        mediaUrls: [url],
        description: `Embedded visual extracted from ${path.basename(params.filename)} (${slideTitleHint}).`,
        technicalSpecs: `PPTX Slide Graphic • ${path.basename(zipPath)}`,
        tags: [
          'pptx',
          'slide',
          ...slideTitleHint
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length >= 2)
            .slice(0, 5),
        ],
      });
      createdAssets.push(asset);
    }

    return url;
  };

  const slides: ImportedSourceSlide[] = [];
  const allMediaUrls: string[] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const slidePath = slideFiles[i];
    const slideNum = slidePath.match(/slide(\d+)\.xml/i)?.[1] || String(i + 1);
    const slideXml = await zip.file(slidePath)!.async('text');
    const lines = extractParagraphLinesFromDrawingXml(slideXml);

    const title = lines[0] || `Slide ${i + 1}`;
    const bullets = lines.slice(1).filter((l) => l !== title);

    // Check slide relationships for notes & embedded images
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsEntry = zip.file(relsPath);
    let speakerNotes = '';
    const slideImageUrls: string[] = [];

    if (relsEntry) {
      const relsXml = await relsEntry.async('text');
      const rels = parseRelsXml(relsXml);

      for (const rel of rels) {
        const resolved = resolvePptxRelativeTarget('ppt/slides', rel.target);
        if (rel.type.toLowerCase().includes('noteslide') || resolved.includes('notesSlides/')) {
          const notesFile = zip.file(resolved);
          if (notesFile) {
            const notesXml = await notesFile.async('text');
            const noteLines = extractParagraphLinesFromDrawingXml(notesXml).filter(
              (line) => !/^\d+$/.test(line.trim())
            );
            speakerNotes = noteLines.join(' ').trim();
          }
        } else if (rel.type.toLowerCase().includes('image') || resolved.startsWith('ppt/media/')) {
          const savedUrl = await saveZipMediaFile(resolved, title);
          if (savedUrl) {
            slideImageUrls.push(savedUrl);
            if (!allMediaUrls.includes(savedUrl)) allMediaUrls.push(savedUrl);
          }
        }
      }
    }

    // Fallback notes path if no rels entry pointed to notesSlide
    if (!speakerNotes) {
      const fallbackNotes = zip.file(`ppt/notesSlides/notesSlide${slideNum}.xml`);
      if (fallbackNotes) {
        const notesXml = await fallbackNotes.async('text');
        const noteLines = extractParagraphLinesFromDrawingXml(notesXml).filter(
          (line) => !/^\d+$/.test(line.trim())
        );
        speakerNotes = noteLines.join(' ').trim();
      }
    }

    const rawText = [title, ...bullets, speakerNotes].filter(Boolean).join('\n');
    slides.push({
      index: i + 1,
      title,
      bullets,
      speakerNotes: speakerNotes || undefined,
      imageUrls: slideImageUrls,
      rawText,
    });
  }

  // Also extract any unreferenced ppt/media/* images
  const mediaEntries = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'));
  for (const mediaPath of mediaEntries) {
    const savedUrl = await saveZipMediaFile(mediaPath, path.basename(params.filename, '.pptx'));
    if (savedUrl && !allMediaUrls.includes(savedUrl)) {
      allMediaUrls.push(savedUrl);
    }
  }

  const deckName =
    params.name?.trim() ||
    path.basename(params.filename, path.extname(params.filename)).replace(/[-_]+/g, ' ').trim() ||
    'Imported Presentation';

  const combinedText = slides.map((s) => `Slide ${s.index}: ${s.rawText}`).join('\n\n');
  const summary = `${slides.length} slides extracted${allMediaUrls.length > 0 ? ` with ${allMediaUrls.length} visual asset(s)` : ''}.`;
  const tags = Array.from(
    new Set(
      [
        'pptx',
        ...deckName.toLowerCase().split(/\s+/),
        ...slides.flatMap((s) => s.title.toLowerCase().split(/\s+/)),
      ]
        .map((t) => t.replace(/[^a-z0-9_-]/g, ''))
        .filter((t) => t.length >= 2)
    )
  ).slice(0, 14);

  return {
    name: deckName,
    sourceType: 'pptx',
    summary,
    rawText: combinedText,
    slides,
    mediaUrls: allMediaUrls,
    assetIds: createdAssets.map((a) => a.id),
    tags,
  };
}

function unescapePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function extractTextOperatorsFromPdfContent(content: string): string[] {
  const chunks: string[] = [];
  const btBlocks = content.match(/BT[\s\S]*?ET/g) || [content];
  for (const block of btBlocks) {
    const tjSingles = block.match(/\((?:\\.|[^\\()])*\)\s*Tj/g) || [];
    for (const op of tjSingles) {
      const inner = op.match(/\(((?:\\.|[^\\()])*)\)/)?.[1];
      if (inner) chunks.push(unescapePdfString(inner));
    }
    const tjArrays = block.match(/\[([\s\S]*?)\]\s*TJ/g) || [];
    for (const arr of tjArrays) {
      const strs = arr.match(/\((?:\\.|[^\\()])*\)/g) || [];
      const joined = strs.map((s) => unescapePdfString(s.slice(1, -1))).join('');
      if (joined.trim()) chunks.push(joined);
    }
  }
  return chunks;
}

export function extractTextFromPdfBuffer(pdfBuffer: Buffer): string {
  const rawLatin = pdfBuffer.toString('latin1');
  const extracted: string[] = [];

  // Attempt zlib inflation of compressed PDF streams
  let pos = 0;
  while (pos < rawLatin.length) {
    const streamIdx = rawLatin.indexOf('stream', pos);
    if (streamIdx < 0) break;
    let dataStart = streamIdx + 6;
    if (rawLatin[dataStart] === '\r' && rawLatin[dataStart + 1] === '\n') dataStart += 2;
    else if (rawLatin[dataStart] === '\n') dataStart += 1;

    const endIdx = rawLatin.indexOf('endstream', dataStart);
    if (endIdx < 0) break;

    const slice = pdfBuffer.subarray(dataStart, endIdx);
    let contentStr = '';
    try {
      contentStr = zlib.inflateSync(slice).toString('utf8');
    } catch {
      try {
        contentStr = zlib.inflateRawSync(slice).toString('utf8');
      } catch {
        contentStr = slice.toString('latin1');
      }
    }
    const ops = extractTextOperatorsFromPdfContent(contentStr);
    extracted.push(...ops);
    pos = endIdx + 9;
  }

  if (extracted.length === 0) {
    extracted.push(...extractTextOperatorsFromPdfContent(rawLatin));
  }

  const combined = extracted.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (combined.length >= 8) {
    return combined;
  }

  // Fallback: readable printable lines outside PDF structural tokens
  const printable = rawLatin
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 10 && !/^(%PDF|obj|endobj|xref|trailer|startxref|<<|>>)/.test(l));
  return printable.join('\n').trim();
}

export function parseStructuredTextSections(rawText: string, fallbackTitle: string): ImportedSourceSlide[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [
      {
        index: 1,
        title: fallbackTitle,
        bullets: [],
        rawText: fallbackTitle,
        imageUrls: [],
      },
    ];
  }

  const lines = normalized.split('\n');
  const sections: ImportedSourceSlide[] = [];
  let currentTitle = '';
  let currentBullets: string[] = [];
  let currentNotes: string[] = [];

  const flushSection = () => {
    if (!currentTitle && currentBullets.length === 0 && currentNotes.length === 0) return;
    const title = currentTitle || currentBullets[0] || `${fallbackTitle} — Part ${sections.length + 1}`;
    const bullets = currentBullets.filter((b) => b !== title);
    const speakerNotes = currentNotes.join(' ').trim() || undefined;
    sections.push({
      index: sections.length + 1,
      title: title.slice(0, 140),
      bullets: bullets.slice(0, 8),
      speakerNotes,
      imageUrls: [],
      rawText: [title, ...bullets, speakerNotes || ''].filter(Boolean).join('\n'),
    });
    currentTitle = '';
    currentBullets = [];
    currentNotes = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headingMatch = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^Slide\s+\d+\s*[:.-]\s*(.+)$/i);
    if (headingMatch) {
      flushSection();
      currentTitle = headingMatch[1].trim();
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bulletMatch) {
      currentBullets.push(bulletMatch[1].trim());
      continue;
    }

    if (/^notes?\s*:/i.test(line)) {
      currentNotes.push(line.replace(/^notes?\s*:/i, '').trim());
      continue;
    }

    if (!currentTitle && currentBullets.length === 0 && line.length <= 90) {
      currentTitle = line;
    } else {
      currentNotes.push(line);
      if (currentBullets.length < 4 && line.length <= 120) {
        currentBullets.push(line);
      }
    }
  }
  flushSection();

  if (sections.length === 0) {
    return [
      {
        index: 1,
        title: fallbackTitle,
        bullets: normalized.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).slice(0, 4),
        speakerNotes: normalized.slice(0, 800),
        imageUrls: [],
        rawText: normalized,
      },
    ];
  }

  return sections;
}

async function probeAudioDurationSec(filePath: string, buffer: Buffer): Promise<number | undefined> {
  const wav = parsePcmWavMono(buffer);
  if (wav) {
    return Number((wav.samples.length / wav.sampleRate).toFixed(2));
  }
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 6000 }
    );
    const parsed = Number.parseFloat(stdout.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Number(parsed.toFixed(2));
    }
  } catch {
    // ffprobe optional
  }
  return undefined;
}

export async function parseAndImportNotebookLm(params: {
  file?: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  };
  rawText?: string;
  name?: string;
  uploadsSourcesDir: string;
}): Promise<Omit<ImportedSource, 'id' | 'createdAt'>> {
  await fs.mkdir(params.uploadsSourcesDir, { recursive: true });
  const ext = params.file ? path.extname(params.file.originalname).toLowerCase() : '';
  const mime = (params.file?.mimetype || '').toLowerCase();
  const isAudio =
    Boolean(params.file) &&
    (mime.startsWith('audio/') ||
      ['.wav', '.mp3', '.m4a', '.webm', '.ogg', '.aac', '.flac'].includes(ext));

  if (isAudio && params.file) {
    const safeExt = ext || '.wav';
    const savedName = `nlm-audio-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${safeExt}`;
    const savedPath = path.join(params.uploadsSourcesDir, savedName);
    await fs.writeFile(savedPath, params.file.buffer);
    const audioUrl = `/uploads/sources/${savedName}`;
    const audioDurationSec = await probeAudioDurationSec(savedPath, params.file.buffer);

    const sourceName =
      params.name?.trim() ||
      path.basename(params.file.originalname, ext).replace(/[-_]+/g, ' ').trim() ||
      'NotebookLM Audio Overview';

    const notesText = (params.rawText || '').trim();
    const slides = notesText
      ? parseStructuredTextSections(notesText, sourceName)
      : [
          {
            index: 1,
            title: sourceName,
            bullets: [
              `NotebookLM Audio Overview (${audioDurationSec ? `${audioDurationSec}s` : 'ready'})`,
              `Audio file: ${params.file.originalname}`,
            ],
            speakerNotes: `Audio Overview sourced from ${params.file.originalname}.`,
            imageUrls: [],
            rawText: sourceName,
          },
        ];

    return {
      name: sourceName,
      sourceType: 'notebooklm-audio',
      summary: `NotebookLM Audio Overview${audioDurationSec ? ` (${audioDurationSec}s)` : ''} • ${slides.length} section(s).`,
      rawText: notesText || sourceName,
      slides,
      mediaUrls: [],
      assetIds: [],
      audioUrl,
      audioDurationSec,
      tags: ['notebooklm', 'audio-overview', ...sourceName.toLowerCase().split(/\s+/).slice(0, 5)],
    };
  }

  let extractedText = (params.rawText || '').trim();
  let docTitle = params.name?.trim() || 'NotebookLM Briefing Doc';

  if (params.file) {
    if (!params.name?.trim()) {
      docTitle =
        path.basename(params.file.originalname, ext).replace(/[-_]+/g, ' ').trim() || docTitle;
    }
    const savedName = `nlm-doc-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext || '.txt'}`;
    await fs.writeFile(path.join(params.uploadsSourcesDir, savedName), params.file.buffer);

    let fileText = '';
    if (ext === '.pdf' || mime === 'application/pdf') {
      fileText = extractTextFromPdfBuffer(params.file.buffer);
    } else {
      fileText = params.file.buffer.toString('utf-8');
    }
    extractedText = [fileText.trim(), extractedText].filter(Boolean).join('\n\n');
  }

  if (!extractedText) {
    throw new Error('Provide NotebookLM notes, a .md/.txt/.pdf Briefing Doc, or an Audio Overview file.');
  }

  const slides = parseStructuredTextSections(extractedText, docTitle);
  const tags = Array.from(
    new Set(
      [
        'notebooklm',
        ...docTitle.toLowerCase().split(/\s+/),
        ...slides.flatMap((s) => s.title.toLowerCase().split(/\s+/)),
      ]
        .map((t) => t.replace(/[^a-z0-9_-]/g, ''))
        .filter((t) => t.length >= 2)
    )
  ).slice(0, 14);

  return {
    name: docTitle,
    sourceType: params.file ? 'notebooklm-doc' : 'notes',
    summary: `${slides.length} structured section(s) parsed from ${params.file ? params.file.originalname : 'NotebookLM notes'}.`,
    rawText: extractedText,
    slides,
    mediaUrls: [],
    assetIds: [],
    tags,
  };
}
