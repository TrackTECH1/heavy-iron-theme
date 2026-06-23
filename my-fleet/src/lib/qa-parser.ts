import type { QaIntent, ParsedQaQuery } from "./qa-types";

const TRACK_SIZE_RE =
  /(\d{3,4})\s*[x×]\s*(\d{2}(?:\.\d+)?)\s*[xBb]?\s*(\d{2,3})/i;

const PRONOUN_RE =
  /\b(for it|for that machine|that machine|this machine|for this one|for that one)\b/i;

const FILLER_RE =
  /\b(what|which|are|is|there|the|a|an|do|you|carry|have|show|me|list|available|option|options|part|parts|fit|fits|fitting|compatible|compatibility|can|i|get|need|looking|tell|about)\b/gi;

const BRAND_ALIASES: [RegExp, string][] = [
  [/\bjd\b/gi, "john deere"],
  [/\bcaterpillar\b/gi, "CAT"],
  [/\bcat\b/gi, "CAT"],
];

const STRIP_PHRASES: RegExp[] = [
  /what\s+(rubber\s+)?tracks?\s+fit\s+/i,
  /what\s+tread\s+options?\s+(are\s+)?(available\s+)?(for\s+)?/i,
  /what\s+patterns?\s+(are\s+)?(available\s+)?(for\s+)?/i,
  /tracks?\s+for\s+/i,
  /do\s+you\s+(carry|have)\s+/i,
  /undercarriage\s+parts?\s+for\s+/i,
  /undercarriage\s+for\s+/i,
  /complete\s+undercarriage\s+kit\s+for\s+/i,
  /sprockets?\s+for\s+/i,
  /rollers?\s+for\s+/i,
  /idlers?\s+for\s+/i,
  /attachments?\s+for\s+/i,
  /\d{3,4}\s*[x×]\s*\d{2}(?:\.\d+)?\s*[xBb]?\s*\d{2,3}\s+track\s+options?\s*/i,
];

const INTENT_RULES: { intent: QaIntent; patterns: RegExp[] }[] = [
  {
    intent: "tread_options",
    patterns: [
      /\btread\s+options?\b/i,
      /\btread\s+patterns?\b/i,
      /\bwhat\s+patterns?\b/i,
      /\bpattern\s+options?\b/i,
    ],
  },
  {
    intent: "kits",
    patterns: [
      /\bcomplete\s+undercarriage\s+kit\b/i,
      /\bundercarriage\s+kit\b/i,
      /\bfull\s+kit\b/i,
    ],
  },
  {
    intent: "sprockets",
    patterns: [/\bsprockets?\b/i],
  },
  {
    intent: "idlers",
    patterns: [/\b(idlers?|front\s+idler|rear\s+idler)\b/i],
  },
  {
    intent: "rollers",
    patterns: [/\b(rollers?|bottom\s+rollers?|top\s+rollers?)\b/i],
  },
  {
    intent: "attachments",
    patterns: [/\battachments?\b/i],
  },
  {
    intent: "undercarriage",
    patterns: [/\bundercarriage\s+parts?\b/i, /\bundercarriage\b/i],
  },
  {
    intent: "tracks",
    patterns: [
      /\b(rubber\s+)?tracks?\b/i,
      /\bwhat\s+tracks?\s+fit\b/i,
      /\btracks?\s+for\b/i,
    ],
  },
];

function detectIntent(q: string): QaIntent {
  const trackSizeOnly =
    TRACK_SIZE_RE.test(q) &&
    !/\b(for|fit|fits|john|deere|cat|kubota|bobcat|ditch|yanmar|takeuchi)\b/i.test(
      q.replace(TRACK_SIZE_RE, ""),
    );
  if (trackSizeOnly) return "track_size";

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(q))) return rule.intent;
  }
  return "general";
}

function extractTrackSize(q: string): string | null {
  const m = q.match(TRACK_SIZE_RE);
  if (!m) return null;
  return `${m[1]}x${m[2]}x${m[3]}`.replace(/\.0+/, "");
}

function extractMachineQuery(q: string): string | null {
  let s = q
    .replace(PRONOUN_RE, "")
    .replace(TRACK_SIZE_RE, " ")
    .replace(/\?/g, " ")
    .trim();

  for (const phrase of STRIP_PHRASES) {
    s = s.replace(phrase, " ");
  }

  s = s
    .replace(FILLER_RE, " ")
    .replace(
      /\b(rubber\s+tracks?|tread\s+options?|sprockets?|idlers?|rollers?|kits?|attachments?)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of BRAND_ALIASES) {
    s = s.replace(pattern, replacement);
  }

  return s.length >= 2 ? s : null;
}

export function parseQaQuestion(
  question: string,
  contextMachineId?: string | null,
): ParsedQaQuery {
  const raw = question.trim();
  const usesContext = PRONOUN_RE.test(raw) && Boolean(contextMachineId);
  const intent = detectIntent(raw);
  const trackSizeQuery = extractTrackSize(raw);
  const machineQuery = usesContext ? null : extractMachineQuery(raw);

  return {
    intent,
    machineQuery,
    trackSizeQuery,
    usesContext,
    rawQuestion: raw,
  };
}

export function intentLabel(intent: QaIntent): string {
  const labels: Record<QaIntent, string> = {
    tracks: "Compatible rubber tracks",
    tread_options: "Tread / pattern options",
    undercarriage: "Undercarriage parts",
    sprockets: "Sprockets",
    rollers: "Rollers",
    idlers: "Idlers",
    kits: "Undercarriage kits",
    attachments: "Attachments",
    track_size: "Products at track size",
    general: "All compatible parts",
  };
  return labels[intent];
}
