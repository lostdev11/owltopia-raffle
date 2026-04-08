import { normalizeTextForUrls } from '@/lib/linkify'

/**
 * Multi-part public suffixes (longer matches must appear before single-label TLDs in alternation).
 */
const DOMAIN_SUFFIXES = [
  'co.uk',
  'com.au',
  'co.nz',
  'com.br',
  'co.jp',
  'co.in',
  'com.mx',
  'co.kr',
  'com.hk',
  'com.sg',
  'com.tw',
  'com.tr',
  'com.ua',
  'com.co',
  'com.ar',
  'com.ve',
  'com.pe',
  'com.ec',
  'gov.uk',
  'org.uk',
  'ac.uk',
  'ne.jp',
  'or.jp',
  'net.au',
  'org.au',
  'edu.au',
  'com.de',
  'co.il',
  'ac.il',
  'org.il',
  'net.il',
  'ac.nz',
  'co.nz',
  'org.nz',
  'net.nz',
  'com.ru',
  'org.ru',
  'net.ru',
  'com.cn',
  'org.cn',
  'net.cn',
  'com.pl',
  'org.pl',
  'net.pl',
  'com.es',
  'org.es',
  'gob.es',
  'com.fr',
  'com.it',
  'org.it',
  'gov.it',
  'com.pt',
  'co.za',
  'co.id',
  'co.th',
  'com.vn',
  'com.ph',
  'com.my',
  'com.pk',
  'co.tz',
  'co.ke',
  'com.eg',
  'com.sa',
  'com.ae',
].map((s) => s.replace(/\./g, '\\.'))

/**
 * Single-label TLDs users use for real sites and common scam / short-link patterns.
 * Omit common file extensions (.zip, .png, …) to avoid false positives on “file.zip”.
 */
const SINGLE_TLDS = [
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'mil',
  'int',
  'io',
  'co',
  'me',
  'tv',
  'gg',
  'app',
  'dev',
  'ai',
  'xyz',
  'info',
  'biz',
  'us',
  'uk',
  'au',
  'ca',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'eu',
  'ru',
  'cn',
  'jp',
  'kr',
  'in',
  'br',
  'mx',
  'nz',
  'se',
  'no',
  'fi',
  'pl',
  'cz',
  'ch',
  'at',
  'be',
  'dk',
  'ie',
  'pt',
  'gr',
  'tr',
  'il',
  'za',
  'ng',
  'ke',
  'tz',
  'ug',
  'eg',
  'ae',
  'sa',
  'qa',
  'kw',
  'bh',
  'pk',
  'bd',
  'lk',
  'np',
  'th',
  'vn',
  'ph',
  'my',
  'sg',
  'id',
  'tw',
  'hk',
  'mo',
  'ar',
  'cl',
  'uy',
  'py',
  'bo',
  'pe',
  'ec',
  've',
  'cr',
  'pa',
  'gt',
  'hn',
  'ni',
  'sv',
  'cu',
  'do',
  'pr',
  'jm',
  'tt',
  'ly',
  'gl',
  'to',
  'ws',
  'cc',
  'ms',
  'sh',
  'ac',
  'ag',
  'is',
  'fm',
  'la',
  'li',
  'lu',
  'lv',
  'md',
  'ro',
  'sk',
  'si',
  'ua',
  'uz',
  'kz',
  'ge',
  'am',
  'by',
  'onion',
  'sol',
  'eth',
  'cloud',
  'pro',
  'online',
  'site',
  'store',
  'shop',
  'blog',
  'news',
  'live',
  'life',
  'world',
  'space',
  'tech',
  'digital',
  'link',
  'click',
  'download',
  'stream',
  'trade',
  'win',
  'bid',
  'top',
  'icu',
  'work',
  'vip',
  'fun',
  'games',
  'party',
  'club',
  'finance',
  'exchange',
  'crypto',
  'nft',
  'dao',
  'defi',
  'wallet',
  'network',
  'capital',
  'global',
  'fund',
  'token',
  'cash',
  'bank',
  'loan',
  'bet',
  'poker',
  'casino',
  'xxx',
  'sex',
  'porn',
  'adult',
  'date',
  'review',
  'account',
  'login',
  'secure',
  'support',
  'help',
  'host',
  'vpn',
  'page',
  'email',
  'mail',
  'chat',
  'im',
  'gift',
  'sale',
  'deals',
  'coupon',
  'claim',
  'verify',
  'official',
  'premium',
]

const TLD_ALTERNATION = [...DOMAIN_SUFFIXES, ...SINGLE_TLDS].join('|')

/** Hostname-style labels dotted, ending in a known suffix. */
const BARE_DOMAIN_RE = new RegExp(
  `\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLD_ALTERNATION})\\b`,
  'i'
)

const IPV4_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?::\d{1,5})?\b/

/** Looks like user@host.tld (phishing without mailto:) */
const EMAIL_LIKE_RE = new RegExp(
  `\\b[a-z0-9._%+-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLD_ALTERNATION})\\b`,
  'i'
)

/** “example dot com” obfuscation */
const DOT_OBFUSCATION_RE =
  /\b[a-z0-9](?:[-a-z0-9]{0,40}[a-z0-9])?\s+dot\s+(?:com|net|org|io|gg|me|tv|xyz|app|dev|ai|info|biz|link|click|online|site|fun|vip)\b/i

/**
 * True when a raffle description includes URLs or link-like patterns (including bare domains and IPs).
 * Non-admin creators must not submit these; admins may.
 */
export function descriptionContainsBlockedLinks(description: string | null | undefined): boolean {
  if (description == null) return false
  const raw = typeof description === 'string' ? description : String(description)
  const s = normalizeTextForUrls(raw)
  if (!s.trim()) return false

  if (/\b[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true
  if (/\b(?:javascript|vbscript|data):/i.test(s)) return true
  if (/\bwww\.\S+/i.test(s)) return true
  if (/\bmailto:/i.test(s)) return true
  if (/\btel:\s*[\d+]/i.test(s)) return true

  if (/\b(?:localhost|127\.0\.0\.1)(?::\d{1,5})?\b/i.test(s)) return true
  if (IPV4_RE.test(s)) return true
  if (BARE_DOMAIN_RE.test(s)) return true
  if (EMAIL_LIKE_RE.test(s)) return true
  if (DOT_OBFUSCATION_RE.test(s)) return true

  if (/\bdiscord\.gg\/[^\s]*/i.test(s)) return true
  if (/\bdiscord(?:app)?\.com\/(?:invite|channels|users)\b/i.test(s)) return true
  if (/\b(?:t\.me|telegram\.me)\/[^\s]+/i.test(s)) return true
  if (/\bwa\.me\/[^\s]+/i.test(s)) return true

  if (/\[[^\]]*\]\(\s*https?:\/\//i.test(s)) return true
  if (/\[[^\]]*\]\(\s*www\./i.test(s)) return true
  if (/\[[^\]]*\]\(\s*mailto:/i.test(s)) return true
  if (/\[[^\]]*\]\(\s*[^\s)]*:\/\//i.test(s)) return true
  if (/\[[^\]]*\]\(\s*[a-z0-9][-a-z0-9.]*\.(?:com|net|org|io|gg|me|tv|xyz|app|dev)\b/i.test(s))
    return true

  return false
}
