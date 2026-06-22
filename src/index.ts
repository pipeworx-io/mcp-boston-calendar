interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * The Boston Calendar MCP.
 *
 * Community "things to do" in Greater Boston, from thebostoncalendar.com's
 * keyless events.json feed (all upcoming events in one structured array).
 * We fetch once and filter/normalize in-pack by date window, keyword, and
 * free-admission. Rich per-event data: venue, geo, times, admission, tags.
 */


const FEED = 'https://www.thebostoncalendar.com/events.json';
const SITE = 'https://www.thebostoncalendar.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const tools: McpToolExport['tools'] = [
  {
    name: 'events',
    description:
      'Upcoming Greater Boston events from The Boston Calendar. Defaults to a 2-week window from today. Filter by date range, keyword (title/description/tags), and free admission. Returns normalized events sorted by date/time.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Earliest event date YYYY-MM-DD (default: today).' },
        to: { type: 'string', description: 'Latest event date YYYY-MM-DD (default: 14 days from `from`). Pass "" for no upper bound.' },
        query: { type: 'string', description: 'Keyword filter over title, description, and tags, e.g. "free music", "kids", "art".' },
        free_only: { type: 'boolean', description: 'If true, only events whose admission is free.' },
        limit: { type: 'number', description: 'Max events to return (1-200, default 50).' },
      },
    },
  },
  {
    name: 'tags',
    description: 'List the event tags/keywords in use on The Boston Calendar, with counts — useful as filterable facets for the events tool.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many top tags to return (default 40).' } },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const events = await fetchEvents();
  switch (name) {
    case 'events':
      return filterEvents(events, args);
    case 'tags':
      return listTags(events, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function fetchEvents(): Promise<RawEvent[]> {
  const res = await fetch(FEED, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Boston Calendar: HTTP ${res.status}`);
  const data = (await res.json()) as RawEvent[];
  return Array.isArray(data) ? data.filter((e) => e && e.id && e.title) : [];
}

function filterEvents(events: RawEvent[], args: Record<string, unknown>): unknown {
  const from = dateArg(args.from) || todayISO();
  const to = args.to === '' ? '' : dateArg(args.to) || addDaysISO(from, 14);
  const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
  const freeOnly = args.free_only === true;
  const limit = clamp(numArg(args.limit, 50), 1, 200);

  let out = events.filter((e) => {
    const d = e.event_date || e.start_date || '';
    if (d && d < from) {
      // keep multi-day events that are still ongoing
      if (!(e.end_date && e.end_date >= from)) return false;
    }
    if (to && d && d > to) return false;
    if (freeOnly && !isFree(e.tag_list)) return false;
    if (q) {
      const hay = `${e.title} ${stripTags(e.description || '')} ${e.tag_list || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Effective date clamps ongoing/recurring entries into the window so a real
  // upcoming event leads instead of an evergreen roundup dated years ago.
  const effKey = (e: RawEvent) => {
    const d = e.event_date || e.start_date || '';
    return `${d && d < from ? from : d} ${String(parseTime(e.start_time)).padStart(4, '0')}`;
  };
  out.sort((a, b) => effKey(a).localeCompare(effKey(b)));

  return {
    metro: 'Greater Boston',
    source: 'thebostoncalendar.com',
    date_from: from,
    date_to: to || null,
    total_matching: out.length,
    count: Math.min(out.length, limit),
    events: out.slice(0, limit).map(normalize),
  };
}

function listTags(events: RawEvent[], args: Record<string, unknown>): unknown {
  const counts = new Map<string, number>();
  for (const e of events) {
    for (const t of splitTags(e.tag_list)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const limit = clamp(numArg(args.limit, 40), 1, 200);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag, count]) => ({ tag, count }));
  return { metro: 'Greater Boston', count: tags.length, tags };
}

interface RawEvent {
  id: number;
  title?: string;
  description?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number | null;
  longitude?: number | null;
  location_name?: string | null;
  event_date?: string;
  start_date?: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  admission?: string;
  slug?: string;
  event_website?: string | null;
  image_url?: string | null;
  cloudinary_url?: string | null;
  tag_list?: string[] | string;
  display?: boolean;
  do_not_display?: boolean;
}

function normalize(e: RawEvent): Record<string, unknown> {
  const venueName = e.location_name || e.address1 || undefined;
  const address = [e.address1, e.city, e.state, e.zip].filter((p) => p && String(p).trim()).join(', ') || undefined;
  return {
    id: e.id,
    title: e.title,
    date: e.event_date || e.start_date,
    end_date: e.end_date && e.end_date !== (e.event_date || e.start_date) ? e.end_date : undefined,
    start_time: e.start_time || undefined,
    end_time: e.end_time || undefined,
    admission: e.admission?.trim() || undefined,
    is_free: isFree(e.tag_list),
    venue: venueName || address ? { name: venueName, address, latitude: e.latitude ?? undefined, longitude: e.longitude ?? undefined } : undefined,
    tags: splitTags(e.tag_list),
    summary: stripTags(e.description || '').replace(/\s+/g, ' ').trim().slice(0, 600) || undefined,
    image: e.image_url || e.cloudinary_url || undefined,
    website: e.event_website || undefined,
    url: e.slug ? `${SITE}/events/${e.slug}` : undefined,
  };
}

function isFree(list?: string[] | string): boolean {
  return splitTags(list).some((t) => /^free$/i.test(t));
}
function splitTags(list?: string[] | string): string[] {
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : [];
  return arr.map((t) => String(t).trim()).filter(Boolean);
}
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&#39;|&#039;/g, "'");
}
/** "7:30pm" -> 1930 (for sorting). */
function parseTime(t?: string): number {
  if (!t) return 0;
  const m = t.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!m) return 0;
  let h = Number(m[1]) % 12;
  if (m[3] === 'pm') h += 12;
  return h * 100 + Number(m[2]);
}
function dateArg(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function todayISO(): string {
  const d = new Date(Date.now() - 4 * 3600 * 1000); // approx US Eastern
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function numArg(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
