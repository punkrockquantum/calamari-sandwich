import type {
  CharacterProfile,
  RagContextMatch,
  SceneItem,
  TechAsset,
} from '../../shared/types.js';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'how',
  'what',
  'why',
  'when',
  'where',
  'are',
  'was',
  'were',
  'can',
  'use',
  'using',
  'scene',
  'add',
  'new',
  'make',
  'set',
  'about',
  'explain',
  'explaining',
  'show',
  'render',
]);

export function tokenizeQuery(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    )
  );
}

function scoreTokens(queryTokens: string[], docText: string, tags: string[] = []): {
  score: number;
  matchedTerms: string[];
} {
  if (queryTokens.length === 0) return { score: 0, matchedTerms: [] };
  const docLower = docText.toLowerCase();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const matchedTerms: string[] = [];
  let score = 0;

  for (const token of queryTokens) {
    if (tagSet.has(token)) {
      score += 3;
      matchedTerms.push(token);
      continue;
    }
    if (docLower.includes(token)) {
      score += 1.5;
      matchedTerms.push(token);
    }
  }

  return { score, matchedTerms };
}

export function retrieveRagContext(params: {
  query: string;
  assets?: TechAsset[];
  characters?: CharacterProfile[];
  scenes?: SceneItem[];
  preferredAssetIds?: string[];
  limit?: number;
}): RagContextMatch[] {
  const queryTokens = tokenizeQuery(params.query);
  const preferredSet = new Set(params.preferredAssetIds || []);
  const limit = params.limit ?? 3;
  const candidates: RagContextMatch[] = [];

  for (const asset of params.assets || []) {
    const docText = `${asset.name} ${asset.category} ${asset.description} ${asset.technicalSpecs}`;
    const { score: rawScore, matchedTerms } = scoreTokens(queryTokens, docText, asset.tags);
    const preferredBoost = preferredSet.has(asset.id) ? 2.5 : 0;
    const score = rawScore + preferredBoost;
    if (score > 0) {
      candidates.push({
        sourceType: 'asset',
        id: asset.id,
        name: asset.name,
        category: asset.category,
        score: Number(score.toFixed(2)),
        matchedTerms,
        snippet: asset.technicalSpecs || asset.description,
        mediaUrl: asset.mediaUrls[0],
        mediaType: asset.sourceType === 'video' ? 'video' : 'image',
      });
    }
  }

  for (const char of params.characters || []) {
    const docText = `${char.name} ${char.role} ${char.stylePreset} ${char.traits.archetype} ${char.traits.wardrobe}`;
    const { score, matchedTerms } = scoreTokens(queryTokens, docText);
    if (score >= 1.5) {
      candidates.push({
        sourceType: 'character',
        id: char.id,
        name: char.name,
        category: char.stylePreset,
        score: Number(score.toFixed(2)),
        matchedTerms,
        snippet: `${char.role} • ${char.traits.archetype}`,
        mediaUrl: char.mediaUrls[0],
        mediaType: char.sourceType === 'video' ? 'video' : char.mediaUrls[0] ? 'image' : undefined,
      });
    }
  }

  for (const sc of params.scenes || []) {
    const docText = `${sc.title} ${sc.visualPrompt} ${sc.keyPoints.join(' ')}`;
    const { score, matchedTerms } = scoreTokens(queryTokens, docText);
    if (score >= 3) {
      candidates.push({
        sourceType: 'scene',
        id: sc.id,
        name: sc.title,
        category: sc.cinematicStyle,
        score: Number((score * 0.7).toFixed(2)),
        matchedTerms,
        snippet: sc.keyPoints[0] || sc.visualPrompt.slice(0, 120),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}
