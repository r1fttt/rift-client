const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const sanitizeHtml = require('sanitize-html');
const { UA } = require('./network.cjs');
const BASE = 'https://launchercontent.mojang.com/';
const FEEDS = { news: BASE + 'news.json', patch: BASE + 'javaPatchNotes.json' };
function httpsUrl(value, base = BASE) {
  try { const url = new URL(value, base); return value && url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
function cleanHtml(html, base = BASE) {
  const $ = cheerio.load(String(html || ''));
  $('a').each((_i, el) => { const href = httpsUrl($(el).attr('href'), base); if (href) $(el).attr('href', href); else $(el).removeAttr('href'); });
  $('img').each((_i, el) => { const src = httpsUrl($(el).attr('src') || $(el).attr('data-src'), base); if (src) $(el).attr('src', src); else $(el).remove(); });
  return sanitizeHtml($('body').html(), {
    allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 's', 'del', 'blockquote', 'pre', 'code', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div', 'span', 'sup', 'sub'],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
    allowedSchemes: ['https'], allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'svg', 'math'],
  });
}
function textOnly(html) { return cheerio.load(String(html || '')).text().replace(/\s+/g, ' ').trim(); }
function normalize(entry, source) {
  if (!entry || typeof entry.title !== 'string' || !entry.title.trim()) return null;
  const key = String(entry.id || crypto.createHash('sha256').update(entry.title).digest('hex'));
  return { id: `${source}:${key}`, source, title: entry.title, summary: textOnly(entry.text || entry.body).slice(0, 240),
    date: entry.date || entry.releaseTime || null, version: entry.version || '',
    category: source === 'patch' ? (entry.type === 'snapshot' ? 'Java snapshot' : 'Java patch notes') : entry.tag || 'Minecraft news',
    image: httpsUrl(entry.newsPageImage?.url || entry.playPageImage?.url || entry.image?.url),
    url: httpsUrl(entry.readMoreLink), contentPath: httpsUrl(entry.contentPath), body: typeof entry.body === 'string' ? entry.body : '' };
}
function mergeFeeds(news, patches) {
  const first = news.map(e => normalize(e, 'news')).filter(Boolean).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const second = patches.map(e => normalize(e, 'patch')).filter(Boolean); // Mojang orders undated patch notes newest first.
  const result = [], seen = new Set();
  for (let i = 0; i < Math.max(first.length, second.length); i++) for (const item of [first[i], second[i]]) {
    if (item && !seen.has(item.id)) { seen.add(item.id); result.push(item); }
  }
  return result.slice(0, 24);
}
async function fetchText(url) {
  let current = httpsUrl(url);
  for (let count = 0; count < 6; count++) {
    if (!current || !['launchercontent.mojang.com', 'minecraft.net', 'www.minecraft.net'].includes(new URL(current).hostname)) throw new Error('This article is not hosted on a supported Minecraft site.');
    const response = await fetch(current, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); current = httpsUrl(response.headers.get('location'), current); continue; }
    if (!response.ok) throw new Error(`Mojang returned ${response.status}. Please try again.`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 10 * 1024 * 1024) throw new Error('Article response exceeds the size limit.'); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Too many article redirects.');
}
function extractArticle(html, url) {
  const $ = cheerio.load(html);
  const selectors = ['.article-section', '[itemprop="articleBody"]', '.article-body', '.article-text', 'article'];
  let content = '';
  for (const selector of selectors) {
    const nodes = $(selector).filter((_i, el) => !$(el).parents(selector).length);
    if (nodes.length) { content = nodes.map((_i, el) => $.html(el)).get().join('\n'); break; }
  }
  if (!content || textOnly(content).length < 80) throw new Error('The full article could not be read. Try again or open the original post.');
  const attribution = $('.MC_articleHeroA_attribution').first().html() || '';
  return cleanHtml(attribution + content, url);
}
class News {
  constructor(root, fetcher = fetchText) { this.root = path.join(root, 'news'); this.fetcher = fetcher; this.entries = []; this.updated = 0; this.pending = null; this.result = null; }
  async readCache(name) { return JSON.parse(await fs.readFile(path.join(this.root, name + '.json'), 'utf8')); }
  async writeCache(name, data) { await fs.mkdir(this.root, { recursive: true }); const file = path.join(this.root, name + '.json'); const temp = file + '.' + crypto.randomUUID() + '.tmp'; await fs.writeFile(temp, JSON.stringify(data)); await fs.rename(temp, file); }
  async list(force = false) {
    if (!force && this.result && Date.now() - this.updated < 5 * 60 * 1000) return this.result;
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = null; }); return this.pending;
  }
  async load() {
    const sources = await Promise.all(Object.entries(FEEDS).map(async ([key, url]) => {
      try { const data = JSON.parse(await this.fetcher(url)); if (!Array.isArray(data.entries)) throw new Error('Invalid Mojang feed'); await this.writeCache(key, data).catch(() => {}); return { entries: data.entries, cached: false }; }
      catch { const data = await this.readCache(key).catch(() => null); return { entries: data?.entries || [], cached: Boolean(data), unavailable: !data }; }
    }));
    this.entries = mergeFeeds(sources[0].entries, sources[1].entries);
    if (!this.entries.length) throw new Error('News is unavailable. Check your connection and try again.');
    this.updated = Date.now();
    this.result = { entries: this.entries.map(({ body, contentPath, ...item }) => item), cached: sources.some(s => s.cached), partial: sources.some(s => s.unavailable) };
    return this.result;
  }
  async post(id) {
    if (!this.entries.length) await this.list();
    const entry = this.entries.find(e => e.id === id); if (!entry) throw new Error('Post not found. Refresh the news feed.');
    const cacheKey = 'post-' + crypto.createHash('sha256').update(id).digest('hex');
    try {
      let body;
      if (entry.body) body = cleanHtml(entry.body);
      else if (entry.source === 'patch' && entry.contentPath) { const content = JSON.parse(await this.fetcher(entry.contentPath)); body = cleanHtml(content.body); }
      else if (entry.url) body = extractArticle(await this.fetcher(entry.url), entry.url);
      if (!body) throw new Error('This post has no article body.');
      const result = { ...entry, body, cached: false }; await this.writeCache(cacheKey, result).catch(() => {}); return result;
    } catch (error) { const cached = await this.readCache(cacheKey).catch(() => null); if (cached) return { ...cached, body: cleanHtml(cached.body, cached.url || BASE), cached: true }; throw error; }
  }
}
module.exports = { News, normalize, mergeFeeds, cleanHtml, extractArticle, httpsUrl };
