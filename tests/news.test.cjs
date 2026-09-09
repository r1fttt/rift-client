const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { News, mergeFeeds, normalize, cleanHtml, extractArticle } = require('../electron/news.cjs');
const news = [{ id: 'n1', title: 'A Minecraft story', date: '2024-01-16', text: 'An introduction', newsPageImage: { url: '/images/story.jpg' }, readMoreLink: 'https://www.minecraft.net/article/story' }];
const patches = [{ id: 'p1', title: 'A snapshot', type: 'snapshot', version: '24w03b', body: '<h1>Changes</h1><p>Full release notes, not a summary.</p>', contentPath: 'javaPatchNotes/p1.json' }];
async function setup(t, fetcher) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r1ft-news-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return new News(root, fetcher); }
test('combines both feeds without inventing dates for undated patch notes', () => { const entries = mergeFeeds(news, patches); assert.deepEqual(entries.map(e => e.source), ['news', 'patch']); assert.equal(entries[1].date, null); assert.equal(entries[0].image, 'https://launchercontent.mojang.com/images/story.jpg'); });
test('normalization rejects invalid cards and merges duplicate IDs only once', () => { assert.equal(normalize({}, 'news'), null); assert.equal(mergeFeeds([...news, ...news], patches).length, 2); });
test('article sanitizer blocks executable markup and launcher IPC action attributes', () => {
  const result = cleanHtml('<p onclick="alert(1)" data-action="launch">Hello</p><script>alert(1)</script><iframe src="https://evil.example"></iframe><svg onload="bad()"></svg><a href="javascript:alert(1)">Bad</a><img src="https://example.com/a.png" onerror="bad()"><a href="/article/test">Good</a>', 'https://www.minecraft.net/');
  assert.doesNotMatch(result, /onclick|onerror|data-action|javascript:|<script|<iframe|<svg|alert/); assert.match(result, /https:\/\/www.minecraft.net\/article\/test/); assert.match(result, /<p>Hello<\/p>/);
});
test('extracts all article sections, preserving formatting without duplicating nested sections or navigation', () => {
  const html = '<nav>Navigation</nav><div class="article-section"><p>' + 'First paragraph. '.repeat(10) + '</p><div class="article-section"><h2>Nested heading</h2></div></div><div class="article-section"><p>Final paragraph.</p></div><footer>Footer</footer>';
  const body = extractArticle(html, 'https://www.minecraft.net/article/test'); assert.match(body, /Final paragraph/); assert.equal(body.match(/Nested heading/g).length, 1); assert.doesNotMatch(body, /Navigation|Footer/);
});
test('refuses to call navigation or an error page a full post', () => { assert.throws(() => extractArticle('<html><nav>Home</nav><p>Access denied</p></html>', 'https://www.minecraft.net/'), /could not be read/); });
test('list omits full body until a post is opened; patch notes preserve full body', async t => {
  const service = await setup(t, async url => JSON.stringify({ entries: url.endsWith('/news.json') ? news : patches }));
  const feed = await service.list(); assert.equal(feed.entries.length, 2); assert.equal(feed.entries[1].body, undefined);
  const post = await service.post('patch:p1'); assert.match(post.body, /Full release notes, not a summary/);
});
test('cached feeds and full posts work when offline', async t => {
  let offline = false;
  const service = await setup(t, async url => { if (offline) throw new Error('Offline'); if (url.includes('/article/')) return '<div class="article-section"><p>' + 'The complete Minecraft story. '.repeat(8) + '</p></div>'; return JSON.stringify({ entries: url.endsWith('/news.json') ? news : patches }); });
  await service.list(); const initial = await service.post('news:n1'); offline = true;
  const feed = await service.list(true); assert.equal(feed.cached, true); const post = await service.post('news:n1'); assert.equal(post.cached, true); assert.equal(post.body, initial.body);
});
test('one failed feed does not prevent the other feed from displaying', async t => {
  const service = await setup(t, async url => { if (url.endsWith('/news.json')) throw new Error('Offline'); return JSON.stringify({ entries: patches }); });
  const feed = await service.list(); assert.equal(feed.partial, true); assert.equal(feed.entries[0].source, 'patch');
});
test('total network failure produces a retryable error; arbitrary post IDs are rejected', async t => {
  const service = await setup(t, async () => { throw new Error('Offline'); }); await assert.rejects(service.list(), /News is unavailable/);
  service.entries = mergeFeeds(news, patches); await assert.rejects(service.post('https://localhost/secret'), /Post not found/);
});
