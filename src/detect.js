/**
 * Classificacao de "pedaco de conhecimento".
 *
 * Uma mensagem pode render zero, um ou varios itens. Cada item carrega um
 * `fingerprint` estavel, que e o que o banco usa para nao contar o mesmo
 * material duas vezes dentro do mesmo grupo.
 */

/** Extensoes de documento -> rotulo exibido. */
const DOCUMENT_EXTENSIONS = {
  pdf: 'PDF',
  doc: 'Word',
  docx: 'Word',
  odt: 'Documento',
  rtf: 'Documento',
  txt: 'Texto',
  md: 'Markdown',
  ppt: 'Slides',
  pptx: 'Slides',
  odp: 'Slides',
  key: 'Slides',
  xls: 'Planilha',
  xlsx: 'Planilha',
  ods: 'Planilha',
  csv: 'Planilha',
  epub: 'E-book',
  mobi: 'E-book',
  azw3: 'E-book',
  djvu: 'E-book',
  ipynb: 'Notebook',
  tex: 'LaTeX',
};

/** Extensoes de arquivo compactado. */
const ARCHIVE_EXTENSIONS = {
  zip: 'ZIP',
  rar: 'RAR',
  '7z': '7z',
  tar: 'TAR',
  gz: 'TAR.GZ',
  tgz: 'TAR.GZ',
  bz2: 'TAR.BZ2',
  xz: 'TAR.XZ',
};

/** Extensoes de midia que so contam quando vem embaladas como documento. */
const MEDIA_EXTENSIONS = {
  mp3: 'Audio',
  m4a: 'Audio',
  wav: 'Audio',
  ogg: 'Audio',
  mp4: 'Video',
  mkv: 'Video',
  mov: 'Video',
  avi: 'Video',
};

/**
 * Regras de link. A primeira que casar vence.
 *
 * `id(url)` produz a parte estavel do fingerprint: quando da para extrair o
 * identificador canonico do material (id do video, id do doc no Drive), dois
 * links diferentes para a mesma coisa colapsam no mesmo item.
 */
const LINK_RULES = [
  {
    category: 'google-docs',
    label: 'Google Docs',
    test: (u) => /(^|\.)(docs|drive|sheets|slides)\.google\.com$/.test(u.hostname),
    id: (u) => {
      const match = u.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/) ?? u.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
      const fromQuery = u.searchParams.get('id');
      return match ? `gdrive:${match[1]}` : fromQuery ? `gdrive:${fromQuery}` : null;
    },
  },
  {
    category: 'notion',
    label: 'Notion',
    test: (u) => /(^|\.)(notion\.so|notion\.site)$/.test(u.hostname),
    id: (u) => {
      const match = u.pathname.match(/([0-9a-f]{32})/i);
      return match ? `notion:${match[1].toLowerCase()}` : null;
    },
  },
  {
    category: 'youtube',
    label: 'YouTube',
    test: (u) => /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(u.hostname),
    id: (u) => {
      if (/(^|\.)youtu\.be$/.test(u.hostname)) {
        const slug = u.pathname.slice(1).split('/')[0];
        return slug ? `youtube:${slug}` : null;
      }
      const v = u.searchParams.get('v');
      if (v) return `youtube:${v}`;
      const match = u.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,})/);
      if (match) return `youtube:${match[1]}`;
      const playlist = u.searchParams.get('list');
      return playlist ? `youtube-playlist:${playlist}` : null;
    },
  },
  {
    category: 'spotify',
    label: 'Podcast',
    test: (u) => /(^|\.)(spotify\.com|spotify\.link)$/.test(u.hostname),
    id: (u) => {
      const match = u.pathname.match(/\/(episode|show|playlist|album)\/([A-Za-z0-9]+)/);
      return match ? `spotify:${match[1]}:${match[2]}` : null;
    },
  },
  {
    category: 'arxiv',
    label: 'Artigo',
    test: (u) => /(^|\.)(arxiv\.org|biorxiv\.org|ssrn\.com|researchgate\.net|scielo\.br|pubmed\.ncbi\.nlm\.nih\.gov|dl\.acm\.org|ieeexplore\.ieee\.org|sciencedirect\.com|jstor\.org|semanticscholar\.org)$/.test(u.hostname),
  },
  {
    category: 'repo',
    label: 'Repositorio',
    test: (u) => /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|huggingface\.co|kaggle\.com|colab\.research\.google\.com)$/.test(u.hostname),
  },
  {
    category: 'cloud',
    label: 'Arquivo na nuvem',
    test: (u) => /(^|\.)(dropbox\.com|1drv\.ms|onedrive\.live\.com|sharepoint\.com|box\.com|mega\.nz|we\.tl|wetransfer\.com|icloud\.com)$/.test(u.hostname),
  },
  {
    category: 'artigo',
    label: 'Artigo',
    test: (u) => /(^|\.)(medium\.com|substack\.com|dev\.to|hashnode\.dev|hashnode\.com|wordpress\.com|blogspot\.com|ghost\.io|wikipedia\.org)$/.test(u.hostname),
  },
  {
    category: 'curso',
    label: 'Curso',
    test: (u) => /(^|\.)(udemy\.com|coursera\.org|edx\.org|alura\.com\.br|khanacademy\.org|datacamp\.com|pluralsight\.com|hotmart\.com|kiwify\.com\.br|maven\.com|deeplearning\.ai)$/.test(u.hostname),
  },
  {
    category: 'apresentacao',
    label: 'Apresentacao',
    test: (u) => /(^|\.)(slideshare\.net|speakerdeck\.com|canva\.com|figma\.com|miro\.com|prezi\.com|gamma\.app|loom\.com|vimeo\.com)$/.test(u.hostname),
  },
  {
    category: 'docs-tecnica',
    label: 'Documentacao',
    test: (u) => /(^|\.)(readthedocs\.io|gitbook\.io|confluence\.com|atlassian\.net|obsidian\.md|roamresearch\.com|coda\.io|slab\.com)$/.test(u.hostname),
  },
];

/**
 * Dominios que nunca contam. Rede social solta, encurtador de convite de grupo
 * e afins normalmente sao meme ou ruido, nao material.
 */
const BLOCKED_DOMAINS = [
  'chat.whatsapp.com',
  'wa.me',
  'api.whatsapp.com',
  'instagram.com',
  'tiktok.com',
  'facebook.com',
  'fb.com',
  'x.com',
  'twitter.com',
  'shopee.com.br',
  'mercadolivre.com.br',
  'amazon.com.br',
  'aliexpress.com',
  'ifood.com.br',
  'meet.google.com',
  'zoom.us',
];

const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<>"'`()[\]{}]+/gi;

/** Corta pontuacao que o WhatsApp costuma grudar no fim de uma URL. */
function trimTrailingPunctuation(raw) {
  return raw.replace(/[.,;:!?'"»)\]}]+$/u, '');
}

export function extractUrls(text) {
  if (!text) return [];
  const found = text.match(URL_REGEX) ?? [];
  return found.map((raw) => {
    const clean = trimTrailingPunctuation(raw);
    return clean.startsWith('http') ? clean : `https://${clean}`;
  });
}

function parseUrl(raw) {
  try {
    const url = new URL(raw);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return url;
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|igshid|si$|ref$|ref_src|source$|spm$|mc_cid|mc_eid|_hs|yclid|msclkid)/i;

/** Fingerprint generico: url sem rastreadores, sem hash, sem barra final. */
function normalizeUrl(url) {
  const copy = new URL(url.toString());
  for (const key of [...copy.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) copy.searchParams.delete(key);
  }
  copy.hash = '';
  copy.protocol = 'https:';
  const query = copy.searchParams.toString();
  const pathname = copy.pathname.replace(/\/+$/, '');
  return `url:${copy.hostname}${pathname}${query ? `?${query}` : ''}`.toLowerCase();
}

export function extensionOf(name) {
  if (!name) return '';
  const clean = name.split(/[?#]/)[0];
  const match = clean.match(/\.([A-Za-z0-9]{1,5})$/);
  return match ? match[1].toLowerCase() : '';
}

function extensionKind(ext) {
  if (DOCUMENT_EXTENSIONS[ext]) return { kind: 'document', category: ext, label: DOCUMENT_EXTENSIONS[ext] };
  if (ARCHIVE_EXTENSIONS[ext]) return { kind: 'archive', category: ext, label: ARCHIVE_EXTENSIONS[ext] };
  if (MEDIA_EXTENSIONS[ext]) return { kind: 'media', category: ext, label: MEDIA_EXTENSIONS[ext] };
  return null;
}

/**
 * Classifica uma URL. Retorna `null` quando ela nao representa conhecimento.
 */
export function classifyUrl(rawUrl, options = {}) {
  const { extraKnowledgeDomains = [], extraBlockedDomains = [] } = options;
  const url = parseUrl(rawUrl);
  if (!url) return null;
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname;
  const matchesDomain = (domain) => host === domain || host.endsWith(`.${domain}`);

  if ([...BLOCKED_DOMAINS, ...extraBlockedDomains].some(matchesDomain)) return null;

  // Link direto para um arquivo vence qualquer regra de dominio.
  const ext = extensionOf(url.pathname);
  const byExtension = extensionKind(ext);
  if (byExtension && byExtension.kind !== 'media') {
    return {
      kind: 'link',
      category: byExtension.category,
      label: byExtension.label,
      fingerprint: normalizeUrl(url),
      raw: url.toString(),
    };
  }

  for (const rule of LINK_RULES) {
    if (!rule.test(url)) continue;
    const canonical = rule.id?.(url) ?? null;
    return {
      kind: 'link',
      category: rule.category,
      label: rule.label,
      fingerprint: canonical ?? normalizeUrl(url),
      raw: url.toString(),
    };
  }

  if (extraKnowledgeDomains.some(matchesDomain)) {
    return {
      kind: 'link',
      category: 'custom',
      label: 'Material',
      fingerprint: normalizeUrl(url),
      raw: url.toString(),
    };
  }

  return null;
}

/**
 * Classifica um anexo a partir dos metadados que o whatsapp-web.js entrega.
 *
 * @param {{ type: string, filename?: string, mimetype?: string, size?: number, hash?: string }} attachment
 */
export function classifyAttachment(attachment, options = {}) {
  const { countNativeMedia = false, dedupFilesByHash = false } = options;
  const { type, filename = '', mimetype = '', size = 0, hash = '' } = attachment;
  // O proprio WhatsApp envia um hash do conteudo; quando ele existe e o dedup
  // por hash esta ligado, renomear o arquivo nao burla a contagem.
  const fingerprintFor = (ext) =>
    dedupFilesByHash && hash ? `file:hash:${hash}` : fileFingerprint(filename, size, ext);

  if (type === 'ptt') return null; // audio de voz nao e material publicado

  const ext = extensionOf(filename) || mimeExtension(mimetype);
  const byExtension = extensionKind(ext);

  if (type === 'document') {
    // Audio/video enviado como documento conta mesmo com COUNT_NATIVE_MEDIA
    // desligado: houve intencao de arquivar, nao de mandar um clipe solto.
    if (!byExtension) return null;
    return {
      kind: byExtension.kind,
      category: byExtension.category,
      label: byExtension.label,
      fingerprint: fingerprintFor(ext),
      raw: filename || `documento.${ext}`,
    };
  }

  if (['video', 'audio', 'image'].includes(type)) {
    if (!countNativeMedia) return null;
    return {
      kind: 'media',
      category: type,
      label: type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Imagem',
      fingerprint: fingerprintFor(ext || type),
      raw: filename || type,
    };
  }

  return null;
}

function mimeExtension(mimetype) {
  const map = {
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/vnd.rar': 'rar',
    'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z',
    'application/gzip': 'gz',
    'application/epub+zip': 'epub',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
  };
  return map[(mimetype || '').split(';')[0].trim().toLowerCase()] ?? '';
}

/** Nome normalizado + tamanho: barato e suficiente para pegar reenvio obvio. */
export function fileFingerprint(filename, size, ext) {
  const base = (filename || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `file:${base || `sem-nome.${ext}`}:${size || 0}`;
}

/**
 * Classifica a mensagem inteira: anexo (se houver) + todos os links do texto.
 * Devolve itens unicos, limitados a `maxItemsPerMessage`.
 *
 * @param {{ text?: string, attachment?: object }} message
 */
export function classifyMessage(message, options = {}) {
  const { maxItemsPerMessage = 3 } = options;
  const items = [];

  if (message.attachment) {
    const item = classifyAttachment(message.attachment, options);
    if (item) items.push(item);
  }

  for (const url of extractUrls(message.text)) {
    const item = classifyUrl(url, options);
    if (item) items.push(item);
  }

  const seen = new Set();
  const unique = items.filter((item) => {
    if (seen.has(item.fingerprint)) return false;
    seen.add(item.fingerprint);
    return true;
  });

  return maxItemsPerMessage > 0 ? unique.slice(0, maxItemsPerMessage) : unique;
}
