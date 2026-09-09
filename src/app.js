import { createIcons, icons } from './icons.js';
import { SkinViewer, WalkingAnimation } from 'skinview3d';
import './style.css';

const api = window.launcher;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const number = n => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const btn = (label, action, symbol, cls = '', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${symbol ? icon(symbol) : ''}${label}</button>`;
const badge = text => `<span class="badge">${esc(text)}</span>`;
const imageUrl = url => { try { const u = new URL(url); return ['https:', 'data:'].includes(u.protocol) ? esc(url) : ''; } catch { return ''; } };
const projectIcon = (item, cls = '') => item.icon_url || item.icon ? `<img class="project-icon ${cls}" src="${imageUrl(item.icon_url || item.icon)}" alt="" loading="lazy">` : `<span class="project-icon fallback ${cls}">${icon('box')}</span>`;
let state, page = 'home', selectedInstance = null, manifest = null, market = { query: '', type: 'modpack', loader: '', version: '', category: '', sort: 'relevance', offset: 0 }, searchGeneration = 0;
let newsItems = [], newsIndex = 0, newsTimer, newsPaused = false, newsLoading = true, newsError = '', newsCached = false, newsPartial = false;
let viewer, closetViewer, toastTimer, modalGeneration = 0, lastFocus, searchTimer;
let skinCache = new Map();
const activeAccount = () => state.accounts.find(a => a.id === state.selectedAccount);
const instance = () => state.instances.find(i => i.id === selectedInstance);
const isBusy = () => ['launching', 'installing', 'running'].includes(state.status.phase);
function redrawIcons(root = document) { createIcons({ icons, root, attrs: { 'stroke-width': 1.8 } }); }
function toast(message, error = false) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.className = error ? 'error visible' : 'visible'; el.textContent = message;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), error ? 8000 : 4500);
}
async function run(action, button) {
  if (button) { button.disabled = true; button.classList.add('working'); }
  try { return await action(); } catch (error) { toast(error.message, true); return null; }
  finally { if (button?.isConnected) { button.disabled = false; button.classList.remove('working'); } }
}
async function refresh() { state = await api.state(); }
function navButton(target, symbol, title) { return `<button class="rail-button ${page === target ? 'active' : ''}" data-action="nav" data-page="${target}" title="${title}" aria-label="${title}">${icon(symbol)}</button>`; }
function render() {
  clearInterval(newsTimer);
  viewer?.dispose(); viewer = null;
  $('#app').innerHTML = `<header class="titlebar"><div class="wordmark"><span class="brand-mark">ϟ</span> R1FT <span class="version">CLIENT</span></div><div class="title-actions">${btn('Quick action <kbd>Ctrl K</kbd>', 'quick', 'search', 'title-button')}${btn('Game log', 'logs', 'terminal', 'title-button')}${btn('Help', 'help', 'circle-help', 'title-button')}<span class="title-divider"></span>${btn('', 'minimize', 'minus', 'window-button', 'aria-label="Minimize"')}${btn('', 'maximize', 'square', 'window-button', 'aria-label="Maximize"')}${btn('', 'close-window', 'x', 'window-button close', 'aria-label="Close window"')}</div></header>
  <div class="layout"><nav class="rail" aria-label="Main navigation"><div class="rail-top">${navButton('home', 'house', 'Home')}${navButton('market', 'store', 'Discover modpacks')}${navButton('mods', 'puzzle', 'Browse mods')}<span class="rail-separator"></span><div class="instance-rail">${state.instances.slice(0, 6).map(i => `<button class="rail-instance ${page === 'instance' && i.id === selectedInstance ? 'active' : ''}" data-action="instance" data-id="${i.id}" title="${esc(i.name)}">${projectIcon(i)}</button>`).join('')}</div>${btn('', 'create', 'plus', 'rail-button', 'aria-label="Create instance" title="Create instance"')}</div><div class="rail-bottom">${navButton('accounts', 'users-round', 'Accounts')}${navButton('settings', 'settings', 'Settings')}</div></nav>
  ${['home', 'market', 'mods'].includes(page) ? `<aside class="sidebar">${page === 'home' ? accountSidebar() : marketSidebar()}</aside>` : ''}
  <main id="main" class="main ${page === 'home' ? 'home-main' : ''}"></main></div><footer class="statusbar"><div class="status-copy"><span id="status-dot" class="status-dot"></span><span id="status-message"></span></div><div class="status-right"><span id="status-percent"></span>${btn('Log', 'logs', 'terminal', 'text-button')}<span class="footer-brand">R1FT Client 0.68.1</span></div><div class="progress-line" id="progress-line"></div></footer>`;
  if (page === 'home') { renderHome(); loadSidebarSkin(); }
  else if (page === 'market' || page === 'mods') renderMarket();
  else if (page === 'instance') renderInstance();
  else if (page === 'accounts') renderAccounts();
  else if (page === 'settings') renderSettings();
  updateStatus(state.status); redrawIcons();
}
function accountSidebar() {
  const account = activeAccount();
  return `<button class="account-switch" data-action="nav" data-page="accounts"><div class="avatar">${icon('user-round')}</div><span><strong>${esc(account?.name || 'Welcome, player')}</strong><small>${account ? account.type === 'offline' ? 'Offline account' : 'Microsoft account' : 'Add an account to play'}</small></span>${icon('chevron-down')}</button><div class="skin-panel"><div class="skin-top"><span>YOUR CHARACTER</span><span class="tiny-dot"></span></div><div class="character-stage"><span class="character-name">${esc(account?.name || 'Your next adventure')}</span><canvas id="skin-canvas" aria-label="Minecraft character preview"></canvas><div class="character-shadow"></div></div>${btn('Local closet', 'closet', 'shirt', 'closet-button')}</div><div class="account-note">${icon(account?.type === 'microsoft' ? 'shield-check' : 'lock-keyhole')}<p>${account?.type === 'microsoft' ? 'Signed in with Microsoft.<br>Your next world is waiting.' : 'Play your way.<br>Sign in with Microsoft for online servers.'}</p>${account?.type !== 'microsoft' ? btn('Sign in with Microsoft', 'login', 'arrow-up-right', 'text-button') : ''}</div><div class="sidebar-bottom"><span class="tiny-dot green"></span> Minecraft: Java Edition</div>`;
}
function marketSidebar() {
  return `<div class="sidebar-heading">DISCOVER SOMETHING NEW</div><label class="field-label">SOURCE</label><div class="source-card">${icon('orbit')}<strong>Modrinth</strong>${icon('circle-check', 'green-text')}</div><label class="field-label" for="sort">SORT BY</label><select id="sort" data-filter="sort">${[['relevance', 'Relevance'], ['downloads', 'Most downloaded'], ['follows', 'Most followed'], ['newest', 'Newest'], ['updated', 'Recently updated']].map(([v, label]) => `<option value="${v}" ${market.sort === v ? 'selected' : ''}>${label}</option>`).join('')}</select><label class="field-label" for="game-version">GAME VERSION</label><select id="game-version" data-filter="version"><option value="">All versions</option>${versionOptions(market.version)}</select><div class="filter-box"><label class="field-label">MOD LOADERS</label><div class="loader-grid">${['fabric', 'forge', 'quilt'].map(l => `<button data-action="filter-loader" data-value="${l}" class="filter-option ${market.loader === l ? 'selected' : ''}">${icon(l === 'fabric' ? 'layers-2' : l === 'forge' ? 'anvil' : 'grid-2x2')}${esc(l[0].toUpperCase() + l.slice(1))}</button>`).join('')}</div></div><div class="filter-box categories"><label class="field-label">CATEGORIES ${icon('chevron-down')}</label>${['adventure', 'optimization', 'technology', 'magic', 'decoration', 'utility', 'worldgen', 'storage'].map((v, i) => `<button data-action="filter-category" data-value="${v}" class="filter-option ${market.category === v ? 'selected' : ''}">${icon(['compass', 'gauge', 'cpu', 'wand-sparkles', 'palette', 'wrench', 'mountain', 'archive'][i])}${v === 'worldgen' ? 'World generation' : v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>${btn('Reset filters', 'reset-filters', 'rotate-ccw', 'text-button reset-filters')}<p class="sidebar-caption">Projects come directly from Modrinth.<br>Fabric, Quilt & Forge supported.</p>`;
}
function versionOptions(selected, all = false) { return (manifest?.versions || []).filter(v => v.type === 'release' || (all && state.settings.snapshots)).map(v => `<option value="${esc(v.id)}" ${selected === v.id ? 'selected' : ''}>${esc(v.id)}${v.type === 'snapshot' ? ' · snapshot' : ''}</option>`).join(''); }
function renderHome() {
  $('#main').innerHTML = `<div class="page-heading home-heading"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h1>Let’s play.</h1></div><span class="edition-label">${icon('box')} JAVA EDITION</span></div><div id="home-hero">${heroMarkup()}</div><section class="library"><div class="section-heading"><h2>${icon('layout-grid', 'red-text')} Your instances <span class="count">${state.instances.length}</span></h2><div class="inline-actions">${btn('', 'folder-root', 'folder-open', 'square-button', 'aria-label="Open launcher folder" title="Open launcher folder"')}${btn('Create game', 'create', 'plus', 'primary')}</div></div><div class="search-input instance-search">${icon('search')}<input id="instance-filter" placeholder="Filter your instances…" aria-label="Filter instances"><kbd>/</kbd></div><div id="instance-grid" class="instance-grid">${instanceCards()}</div></section><div class="home-footnote">${icon('sparkles')} A fresh world. A familiar feeling. <span>Make it yours.</span></div>`;
  $('#instance-filter').addEventListener('input', e => { $('#instance-grid').innerHTML = instanceCards(e.target.value); redrawIcons(); });
  startNewsCycle();
}
function postDate(item) { const date = new Date(item.date); return item.date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : item.version; }
function heroMarkup() {
  const item = newsItems[newsIndex];
  if (!item) return `<section class="hero news-empty"><div class="voxel-scene"><div class="voxel-sun"></div><div class="voxel-mountain mountain-back"></div><div class="voxel-mountain"></div><div class="voxel-ground"></div><div class="voxel-block block-one"></div><div class="voxel-tree"></div><span class="scene-caption">YOUR WORLD, REIMAGINED.</span></div><div class="hero-copy"><span class="eyebrow">STRAIGHT FROM MOJANG</span><h2>${newsLoading ? 'Loading Minecraft news…' : 'News is taking a break.'}</h2><p>${esc(newsError || 'News, snapshots, and the details behind your next adventure.')}</p>${!newsLoading ? btn('Try again', 'refresh-news', 'rotate-cw', 'text-button red-text') : '<span class="spinner"></span>'}</div></section>`;
  return `<article class="hero news-hero" data-action="news-post" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Read ${esc(item.title)}"><div class="hero-art">${item.image ? `<img src="${imageUrl(item.image)}" alt="${esc(item.title)}">` : '<div class="hero-project-icon">' + icon('box') + '</div>'}<span class="image-label">${icon(item.source === 'patch' ? 'layers-2' : 'orbit')} ${item.source === 'patch' ? 'JAVA EDITION' : 'MINECRAFT NEWS'}</span></div><div class="hero-copy"><span class="eyebrow"><span class="tiny-dot green"></span> ${esc(item.category)} ${postDate(item) ? ' · ' + esc(postDate(item)) : ''}</span><h2>${esc(item.title)}</h2><p>${esc(item.summary)}</p><span class="read-post">Read full post ${icon('arrow-up-right')}</span><div class="hero-meta">Mojang Studios${newsCached ? ' · Saved feed' : ''}${newsPartial ? ' · One feed unavailable' : ''}</div></div></article><div class="news-controls" aria-label="News carousel"><div class="news-navigation">${btn('', 'previous-news', 'chevron-left', 'news-control', 'aria-label="Previous news"')}${btn('', 'toggle-news', newsPaused ? 'play' : 'square', 'news-control', `aria-label="${newsPaused ? 'Resume' : 'Pause'} news rotation" aria-pressed="${newsPaused}"`)}${btn('', 'next-news', 'chevron-right', 'news-control', 'aria-label="Next news"')}</div><div class="news-dots">${newsItems.map((entry, i) => `<button data-action="select-news" data-index="${i}" class="news-dot ${i === newsIndex ? 'selected' : ''}" aria-label="Show ${esc(entry.title)}" aria-current="${i === newsIndex ? 'true' : 'false'}"></button>`).join('')}</div><div class="news-counter">${newsIndex + 1} / ${newsItems.length}${btn('', 'refresh-news', 'rotate-cw', 'news-control', 'aria-label="Refresh news"')}</div></div>`;
}
function paintNews() { if (page === 'home' && $('#home-hero')) { $('#home-hero').innerHTML = heroMarkup(); redrawIcons(); } }
function startNewsCycle() {
  clearInterval(newsTimer);
  newsTimer = setInterval(() => {
    const root = $('#home-hero');
    if (page !== 'home' || newsPaused || document.hidden || $('#modal-overlay') || !root || root.matches(':hover') || root.contains(document.activeElement) || newsItems.length < 2) return;
    newsIndex = (newsIndex + 1) % newsItems.length; paintNews();
  }, 8000);
}
function changeNews(index) { newsIndex = (index + newsItems.length) % newsItems.length; paintNews(); startNewsCycle(); }
async function newsPost(id) {
  const item = newsItems.find(entry => entry.id === id);
  const generation = showModal(`${modalHeader(esc(item?.title || 'Minecraft news'), 'Mojang Studios', 'orbit')}<div class="loading-state"><span class="spinner"></span> Loading the full post…</div>`, 'news-modal');
  try {
    const post = await api['news-post'](id); if (generation !== modalGeneration) return;
    $('.modal').innerHTML = `${modalHeader(esc(post.title), [post.category, postDate(post), 'Mojang Studios', post.cached ? 'Saved article' : ''].filter(Boolean).map(esc).join(' · '), 'orbit')}${post.image ? `<img class="post-cover" src="${imageUrl(post.image)}" alt="${esc(post.title)}">` : ''}<article class="post-body">${post.body}</article><div class="modal-footer">${post.url ? btn('Open original post', 'news-link', 'arrow-up-right', 'text-button', `data-url="${esc(post.url)}"`) : ''}${btn('Close', 'close-modal', '', 'secondary')}</div>`; redrawIcons();
  } catch (error) {
    if (generation !== modalGeneration) return;
    $('.modal').innerHTML = `${modalHeader(esc(item?.title || 'Minecraft news'), '', 'wifi-off')}<p class="error-text">${esc(error.message)}</p><div class="modal-footer">${item?.url ? btn('Open original post', 'news-link', 'arrow-up-right', 'text-button', `data-url="${esc(item.url)}"`) : ''}${btn('Try again', 'news-post', 'rotate-cw', 'primary', `data-id="${esc(id)}"`)}</div>`; redrawIcons();
  }
}
function instanceCards(filter = '') {
  const items = state.instances.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()));
  if (!items.length) return `<div class="empty-state library-empty">${icon(filter ? 'search-x' : 'box')}<h3>${filter ? 'No matching instances' : 'Every adventure starts somewhere.'}</h3><p>${filter ? 'Try another name.' : 'Create a Minecraft instance or find your next favorite modpack.'}</p>${!filter ? `<div class="inline-actions">${btn('Create your first game', 'create', 'plus', 'primary')}${btn('Browse modpacks', 'discover', 'arrow-right', 'secondary')}</div>` : ''}</div>`;
  return items.map(i => `<article class="instance-card" data-action="instance" data-id="${i.id}" tabindex="0" role="button" aria-label="Manage ${esc(i.name)}">${projectIcon(i)}<div class="instance-copy"><h3>${esc(i.name)}</h3><p>${esc(i.minecraft)} <span>·</span> ${esc(i.loader)}</p></div><button class="play-small" data-action="launch" data-id="${i.id}" aria-label="Launch ${esc(i.name)}" ${isBusy() ? 'disabled' : ''}>${icon('play')}</button></article>`).join('');
}
async function loadHero(force = false) {
  newsLoading = true;
  try { const result = await api.news(force); const current = newsItems[newsIndex]?.id; newsItems = result.entries; newsIndex = Math.max(0, newsItems.findIndex(item => item.id === current)); newsCached = result.cached; newsPartial = result.partial; newsError = ''; }
  catch (error) { newsError = error.message; if (newsItems.length && force) toast(error.message, true); }
  finally { newsLoading = false; paintNews(); }
}
function defaultSkin() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#bb8b6b'; ctx.fillRect(0, 0, 32, 16); ctx.fillRect(40, 16, 16, 16); ctx.fillRect(32, 48, 16, 16);
  ctx.fillStyle = '#342922'; ctx.fillRect(8, 0, 8, 8); ctx.fillRect(0, 8, 8, 8); ctx.fillRect(16, 8, 16, 8); ctx.fillRect(8, 8, 8, 2);
  ctx.fillStyle = '#f1e9de'; ctx.fillRect(9, 12, 2, 1); ctx.fillRect(13, 12, 2, 1); ctx.fillStyle = '#55569b'; ctx.fillRect(10, 12, 1, 1); ctx.fillRect(13, 12, 1, 1); ctx.fillStyle = '#5b3c31'; ctx.fillRect(11, 14, 2, 1);
  ctx.fillStyle = '#e1353d'; ctx.fillRect(16, 16, 24, 16); ctx.fillRect(40, 16, 16, 7); ctx.fillRect(32, 48, 16, 7); ctx.fillStyle = '#bc2833'; ctx.fillRect(20, 20, 2, 12);
  ctx.fillStyle = '#30333e'; ctx.fillRect(0, 16, 16, 16); ctx.fillRect(16, 48, 16, 16); ctx.fillStyle = '#e6e2df'; ctx.fillRect(0, 29, 16, 3); ctx.fillRect(16, 61, 16, 3);
  return canvas.toDataURL();
}
const builtInSkin = defaultSkin();
async function skinData(id) { if (!id) return builtInSkin; if (!skinCache.has(id)) skinCache.set(id, await api['skin-data'](id)); return skinCache.get(id); }
async function loadSidebarSkin() {
  const canvas = $('#skin-canvas'); if (!canvas) return;
  const account = activeAccount(); const skin = state.skins.find(s => s.id === account?.skinId);
  const data = await skinData(skin?.id).catch(() => builtInSkin);
  if (!canvas.isConnected) return;
  try { viewer = new SkinViewer({ canvas, width: 230, height: 320, skin: data, model: skin?.model || 'default' }); viewer.zoom = 0.83; viewer.controls.enableZoom = false; viewer.controls.enablePan = false; viewer.animation = new WalkingAnimation(); viewer.animation.speed = 0.25; viewer.playerObject.rotation.y = -0.22; } catch { canvas.replaceWith(Object.assign(document.createElement('p'), { textContent: '3D preview unavailable on this device.' })); }
}
function renderMarket() {
  $('#main').innerHTML = `<div class="market-header"><div class="search-input big-search">${icon('search')}<input id="market-search" value="${esc(market.query)}" placeholder="Search ${page === 'mods' ? 'mods, resource packs, and shaders' : 'modpacks'} on Modrinth…" aria-label="Search Modrinth"><kbd>↵</kbd></div></div><div class="market-body"><div class="section-heading"><div><span class="eyebrow">A WHOLE NEW WAY TO PLAY</span><h1>${page === 'mods' ? 'Make it your Minecraft.' : 'Find your next adventure.'}</h1></div>${icon(page === 'mods' ? 'puzzle' : 'flame', 'heading-icon')}</div>${page === 'mods' ? `<div class="tabs">${[['mod', 'Mods'], ['resourcepack', 'Resource packs'], ['shader', 'Shaders']].map(([type, name]) => `<button class="${market.type === type ? 'active' : ''}" data-action="content-type" data-type="${type}">${name}</button>`).join('')}</div>` : ''}<div class="results-heading"><span id="results-count">Connecting to Modrinth…</span><span class="modrinth-credit"><span class="tiny-dot green"></span> Powered by Modrinth</span></div><div id="results" class="project-grid"><div class="loading-state"><span class="spinner"></span> Finding your next favorite…</div></div><div class="pagination" id="pagination"></div></div>`;
  $('#market-search').addEventListener('input', e => { market.query = e.target.value; market.offset = 0; clearTimeout(searchTimer); searchTimer = setTimeout(search, 350); });
  $('#market-search').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTimer); search(); } });
  search();
}
async function search() {
  const generation = ++searchGeneration;
  try {
    const result = await api.search(market);
    if (generation !== searchGeneration || !['market', 'mods'].includes(page)) return;
    $('#results-count').textContent = `${number(result.total_hits)} ${market.type === 'modpack' ? 'modpacks' : 'projects'}${market.query ? ` for “${market.query}”` : ' to explore'}`;
    $('#results').innerHTML = result.hits.length ? result.hits.map(projectCard).join('') : `<div class="empty-state">${icon('search-x')}<h3>No projects found</h3><p>Try another search or clear your filters.</p>${btn('Clear filters', 'reset-filters', 'rotate-ccw', 'secondary')}</div>`;
    $('#pagination').innerHTML = `${btn('Previous', 'previous-page', 'chevron-left', 'secondary', market.offset === 0 ? 'disabled' : '')}<span>Page ${Math.floor(market.offset / 20) + 1}</span>${btn('Next', 'next-page', 'chevron-right', 'secondary', market.offset + 20 >= result.total_hits ? 'disabled' : '')}`;
    redrawIcons();
  } catch (error) {
    if (generation !== searchGeneration || !$('#results')) return;
    $('#results-count').textContent = 'Could not load Modrinth';
    $('#results').innerHTML = `<div class="empty-state">${icon('wifi-off')}<h3>We couldn’t reach Modrinth.</h3><p>${esc(error.message)}</p>${btn('Try again', 'retry-search', 'rotate-cw', 'secondary')}</div>`; redrawIcons();
  }
}
function projectCard(p) {
  const art = p.featured_gallery || p.gallery?.[0];
  return `<article class="project-card" data-action="project" data-id="${esc(p.project_id)}" tabindex="0" role="button" aria-label="View ${esc(p.title)}">${market.type === 'modpack' ? `<div class="project-cover ${art ? '' : 'no-cover'}">${art ? `<img src="${imageUrl(art)}" alt="" loading="lazy">` : projectIcon(p)}<span class="cover-label">${icon('orbit')} MODRINTH</span></div>` : ''}<div class="project-card-body"><div class="project-title">${projectIcon(p)}<div><h3>${esc(p.title)}</h3><span>by ${esc(p.author)}</span></div></div><p class="project-description">${esc(p.description)}</p><div class="project-tags">${(p.display_categories || p.categories || []).slice(0, 3).map(badge).join('')}</div><div class="project-bottom"><span>${icon('download')} ${number(p.downloads)}</span><span class="browse-label">Explore ${icon('arrow-up-right')}</span></div></div></article>`;
}
async function renderInstance() {
  const item = instance();
  if (!item) { page = 'home'; render(); return; }
  $('#main').innerHTML = `<div class="instance-page"><button class="back-link" data-action="nav" data-page="home">${icon('arrow-left')} Back to your instances</button><div class="instance-header"><div class="instance-name">${projectIcon(item)}<div><span class="eyebrow">YOUR INSTANCE</span><h1>${esc(item.name)}</h1></div></div><div class="inline-actions">${btn('', 'logs', 'terminal', 'square-button', 'title="Game log" aria-label="Game log"')}${btn('', 'instance-folder', 'folder-open', 'square-button', 'title="Open instance folder" aria-label="Open instance folder"')}${btn('', 'instance-settings', 'settings-2', 'square-button', 'title="Instance settings" aria-label="Instance settings"')}</div></div><div class="instance-toolbar"><div class="instance-stat">${icon('layers-2')}<div><label>VERSION</label><strong>${esc(item.minecraft)} · ${esc(item.loader)} ${esc(item.loaderVersion)}</strong></div></div><div class="instance-stat">${icon('clock-3')}<div><label>PLAYTIME</label><strong>${item.playtime ? `${Math.round(item.playtime / 60000)} minutes` : 'Never played'}</strong></div></div><div class="instance-stat">${icon('history')}<div><label>LAST PLAYED</label><strong>${item.lastPlayed ? new Date(item.lastPlayed).toLocaleDateString() : 'Ready when you are'}</strong></div></div>${state.running === item.id ? btn('Stop game', 'stop', 'square', 'primary launch-button') : btn('Launch', 'launch', 'play', 'primary launch-button', `data-id="${item.id}" ${isBusy() ? 'disabled' : ''}`)}</div><div class="divider-label">${icon('chevron-down')}</div><div id="content-panels" class="content-panels"><div class="loading-state"><span class="spinner"></span> Loading your instance…</div></div></div>`;
  redrawIcons();
  try {
    const contents = await api['content-list'](item.id);
    if (page !== 'instance' || selectedInstance !== item.id) return;
    $('#content-panels').innerHTML = [['mods', 'Mods', 'puzzle', 'mod'], ['resourcepacks', 'Resource packs', 'palette', 'resourcepack'], ['saves', 'Worlds', 'map', ''], ['shaderpacks', 'Shader packs', 'sun', 'shader']].map(([folder, name, symbol, type]) => `<section class="content-panel"><h2>${icon(symbol)} ${name}</h2><p>${contents[folder].filter(f => f.enabled).length} ${folder === 'saves' ? 'saved worlds' : 'enabled'}</p><div class="content-preview">${contents[folder].slice(0, 10).map(f => `<span class="file-pill ${f.enabled ? '' : 'disabled-file'}" title="${esc(f.name)}">${icon(folder === 'saves' ? 'mountain' : 'package')}${esc(f.name.replace(/\.(jar|zip)(\.disabled)?$/, ''))}</span>`).join('') || `<div class="content-empty">${icon(symbol)}<span>${folder === 'saves' ? 'Your worlds will appear here.' : `A little room for something new.`}</span></div>`}</div><div class="panel-actions">${btn(folder === 'saves' ? 'Open worlds folder' : 'Manage', folder === 'saves' ? 'content-folder' : 'manage-content', folder === 'saves' ? 'folder-open' : 'settings', 'text-button', `data-folder="${folder}"`)}${type ? btn('Install', 'browse-content', 'download', 'text-button red-text', `data-type="${type}"`) : ''}</div></section>`).join(''); redrawIcons();
  } catch (error) { if ($('#content-panels')) $('#content-panels').innerHTML = `<p class="error-text">${esc(error.message)}</p>`; }
}
function renderAccounts() {
  $('#main').innerHTML = `<div class="standard-page"><span class="eyebrow">A PLACE FOR EVERY PLAYER</span><h1>Your accounts</h1><p class="page-description">Choose who’s heading into the next adventure.</p><div class="accounts-list">${state.accounts.map(a => `<div class="account-row"><div class="avatar large">${icon(a.type === 'microsoft' ? 'shield-check' : 'user-round')}</div><div class="grow"><h3>${esc(a.name)}</h3><p>${a.type === 'microsoft' ? 'Microsoft · Minecraft Java' : 'Offline · Singleplayer & offline-mode servers'}</p></div>${a.id === state.selectedAccount ? `<span class="selected-label">${icon('circle-check')} Selected</span>` : btn('Select', 'select-account', 'check', 'secondary', `data-id="${a.id}"`)}${btn('', 'remove-account', 'trash-2', 'square-button danger-text', `data-id="${a.id}" title="Remove account" aria-label="Remove ${esc(a.name)}"`)}</div>`).join('') || `<div class="empty-state">${icon('users-round')}<h3>Meet your next Minecraft character.</h3><p>Add an account below to get started.</p></div>`}</div><div class="account-add-grid"><section class="settings-card"><div class="card-symbol microsoft-logo"><span></span><span></span><span></span><span></span></div><h2>Microsoft account</h2><p>Sign in securely to play with your Minecraft Java account and join online servers.</p>${btn('Sign in with Microsoft', 'login', 'arrow-up-right', 'primary')}</section><section class="settings-card">${icon('user-round', 'card-symbol')}<h2>Offline account</h2><p>Use a local username for singleplayer and servers that allow offline accounts.</p><form id="offline-form"><label class="sr-only" for="offline-name">Offline username</label><div class="inline-actions"><input id="offline-name" name="name" placeholder="Minecraft username" minlength="3" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" required autocomplete="off"><button class="secondary" type="submit">${icon('plus')} Add account</button></div><small>3–16 letters, numbers, or underscores</small></form></section></div>${!state.secureStorage ? `<p class="info-note">${icon('key-round')} OS credential encryption is unavailable. Microsoft sessions will be kept only until you close the launcher.</p>` : ''}</div>`;
  $('#offline-form').addEventListener('submit', e => { e.preventDefault(); run(async () => { state = await api['offline-add']($('#offline-name').value); render(); toast('Offline account added'); }, $('button', e.target)); });
}
function renderSettings() {
  const s = state.settings;
  $('#main').innerHTML = `<div class="standard-page settings-page"><span class="eyebrow">MAKE IT FEEL LIKE YOURS</span><h1>Launcher settings</h1><p class="page-description">A few small adjustments. A better way to play.</p><form id="settings-form"><section class="settings-card"><h2>${icon('cpu')} Performance</h2><div class="setting-description"><div><h3>Memory allocation</h3><p>How much RAM Minecraft can use. Leave some for your system.</p></div><output id="memory-output">${(s.memory / 1024).toFixed(1)} GB</output></div><input type="range" id="memory" min="512" max="${Math.floor(state.totalMemory / 512) * 512}" step="512" value="${s.memory}" aria-label="Memory allocation"><div class="range-labels"><span>512 MB</span><span>${(state.totalMemory / 1024).toFixed(0)} GB system memory</span></div></section><section class="settings-card"><h2>${icon('coffee')} Java runtime</h2><label class="setting-toggle"><div><h3>Automatically manage Java</h3><p>Download the correct Eclipse Temurin runtime for each Minecraft version.</p></div><input type="checkbox" id="auto-java" ${s.autoJava ? 'checked' : ''}><span class="switch"></span></label><label class="field-label" for="java-path">CUSTOM JAVA EXECUTABLE</label><div class="inline-actions"><input id="java-path" value="${esc(s.javaPath)}" placeholder="java" ${s.autoJava ? 'disabled' : ''}>${btn('Browse', 'pick-java', 'folder-open', 'secondary', 'type="button"')}</div><small>Used when automatic Java is turned off.</small></section><section class="settings-card"><h2>${icon('sliders-horizontal')} Preferences</h2><label class="setting-toggle"><div><h3>Show snapshots</h3><p>Include experimental Minecraft versions when creating a game.</p></div><input id="snapshots" type="checkbox" ${s.snapshots ? 'checked' : ''}><span class="switch"></span></label><label class="setting-toggle"><div><h3>Hide launcher while playing</h3><p>The launcher returns when Minecraft closes.</p></div><input id="hide-launcher" type="checkbox" ${s.closeOnLaunch ? 'checked' : ''}><span class="switch"></span></label></section><div class="settings-save"><p>${icon('folder')} ${esc(state.dataPath)}</p><button class="primary" type="submit">${icon('check')} Save settings</button></div></form></div>`;
  $('#memory').addEventListener('input', e => $('#memory-output').textContent = `${(e.target.value / 1024).toFixed(1)} GB`);
  $('#auto-java').addEventListener('change', e => $('#java-path').disabled = e.target.checked);
  $('#settings-form').addEventListener('submit', e => { e.preventDefault(); run(async () => { state = await api['settings-save']({ memory: Number($('#memory').value), javaPath: $('#java-path').value, autoJava: $('#auto-java').checked, snapshots: $('#snapshots').checked, closeOnLaunch: $('#hide-launcher').checked }); toast('Settings saved'); }, $('button[type="submit"]', e.target)); });
}
function showModal(content, cls = '') {
  closeModal(); lastFocus = document.activeElement; const overlay = document.createElement('div'); overlay.id = 'modal-overlay'; overlay.className = 'modal-overlay';
  overlay.innerHTML = `<section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="Launcher dialog">${content}</section>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.append(overlay); redrawIcons(); setTimeout(() => $('input, select, button', overlay)?.focus(), 20); return ++modalGeneration;
}
function closeModal() { modalGeneration++; closetViewer?.dispose(); closetViewer = null; $('#modal-overlay')?.remove(); lastFocus?.focus(); }
function modalHeader(title, subtitle = '', symbol = 'box') { return `<div class="modal-header"><div><h2>${icon(symbol, 'red-text')} ${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${btn('', 'close-modal', 'x', 'square-button', 'aria-label="Close dialog"')}</div>`; }
async function createModal() {
  const generation = showModal(`${modalHeader('Create game', 'A new world deserves a fresh start.', 'plus')}<form id="create-form"><label class="field-label" for="create-name">INSTANCE NAME</label><input id="create-name" placeholder="My next adventure" maxlength="80" required><div class="form-grid"><div><label class="field-label" for="create-version">MINECRAFT VERSION</label><select id="create-version" required><option value="">Loading versions…</option></select></div><div><label class="field-label" for="create-loader">MOD LOADER</label><select id="create-loader"><option value="vanilla">Vanilla</option><option value="fabric">Fabric</option><option value="quilt">Quilt</option><option value="forge">Forge</option></select></div></div><label class="field-label" for="create-loader-version">LOADER VERSION</label><select id="create-loader-version" disabled><option value="">Not needed for Vanilla</option></select><p class="info-note">${icon('download')} Minecraft and the right Java runtime download on first launch.</p><p id="create-error" class="error-text" role="alert"></p><div class="modal-footer">${btn('Cancel', 'close-modal', '', 'secondary', 'type="button"')}<button class="primary" type="submit">${icon('plus')} Create game</button></div></form>`);
  const versionSelect = $('#create-version'); let loaderGeneration = 0;
  const load = async () => {
    const current = ++loaderGeneration; const loader = $('#create-loader').value; const target = $('#create-loader-version');
    target.innerHTML = '<option value="">Loading…</option>'; target.disabled = true;
    if (loader === 'vanilla') { target.innerHTML = '<option value="">Not needed for Vanilla</option>'; return; }
    try { const options = await api.loaders({ minecraft: versionSelect.value, loader }); if (current !== loaderGeneration || generation !== modalGeneration) return; target.innerHTML = options.map(v => `<option value="${esc(v.version)}">${esc(v.version)}</option>`).join('') || '<option value="">No compatible loader</option>'; target.disabled = !options.length; }
    catch (e) { if (current === loaderGeneration && generation === modalGeneration) { target.innerHTML = '<option value="">Unavailable</option>'; $('#create-error').textContent = e.message; } }
  };
  versionSelect.addEventListener('change', load); $('#create-loader').addEventListener('change', load);
  $('#create-form').addEventListener('submit', e => { e.preventDefault(); const input = { name: $('#create-name').value, minecraft: versionSelect.value, loader: $('#create-loader').value, loaderVersion: $('#create-loader-version').value }; run(async () => { const created = await api['instance-create'](input); await refresh(); closeModal(); selectedInstance = created.id; page = 'instance'; render(); toast('Your instance is ready'); }, $('button[type="submit"]', e.target)); });
  try { if (!manifest) manifest = await api.versions(); if (generation === modalGeneration) versionSelect.innerHTML = versionOptions(manifest.latest.release, true); }
  catch (e) { if (generation === modalGeneration) { $('#create-error').textContent = e.message; versionSelect.innerHTML = '<option value="">Versions unavailable — reopen to retry</option>'; } }
}
async function projectModal(id) {
  const generation = showModal(`${modalHeader('Project details', '', 'orbit')}<div class="loading-state"><span class="spinner"></span> Loading project…</div>`, 'project-modal');
  let project, versions;
  try { [project, versions] = await Promise.all([api.project(id), api['project-versions']({ id })]); }
  catch (error) {
    if (generation === modalGeneration) { $('.modal').innerHTML = `${modalHeader('Project unavailable', '', 'wifi-off')}<p class="error-text">${esc(error.message)}</p><div class="modal-footer">${btn('Try again', 'project', 'rotate-cw', 'primary', `data-id="${esc(id)}"`)}</div>`; redrawIcons(); }
    return;
  }
  if (generation !== modalGeneration) return;
  const pack = project.project_type === 'modpack';
  const targets = state.instances.filter(i => project.project_type !== 'mod' || i.loader !== 'vanilla');
  const supported = versions.filter(v => !pack || v.loaders.some(l => ['fabric', 'quilt', 'forge', 'minecraft'].includes(l)));
  const art = project.gallery?.find(g => g.featured)?.url || project.gallery?.[0]?.url;
  $('.modal').innerHTML = `${modalHeader(esc(project.title), esc(project.description), 'orbit')}${art ? `<img class="detail-cover" src="${imageUrl(art)}" alt="${esc(project.title)}">` : ''}<div class="detail-stats">${badge(project.project_type)}${badge(`${number(project.downloads)} downloads`)}${(project.categories || []).slice(0, 4).map(badge).join('')}</div><div class="project-install"><label class="field-label" for="install-instance">${pack ? 'INSTANCE' : 'INSTALL TO'}</label>${pack ? '<p class="muted">Creates a new, isolated instance with the pack’s Minecraft and loader versions.</p>' : `<select id="install-instance"><option value="">Select an instance</option>${targets.map(i => `<option value="${i.id}" ${selectedInstance === i.id ? 'selected' : ''}>${esc(i.name)} · ${esc(i.minecraft)} / ${esc(i.loader)}</option>`).join('')}</select>`}<label class="field-label" for="install-version">PROJECT VERSION</label><select id="install-version"></select><p id="install-note" class="muted small"></p></div><div class="modal-footer">${btn('View on Modrinth', 'external', 'arrow-up-right', 'text-button', `data-url="https://modrinth.com/${project.project_type}/${esc(project.slug)}"`)}<button id="install-project" class="primary">${icon('download')} ${pack ? 'Install modpack' : 'Install'}</button></div>`;
  const versionOptionsFor = list => { $('#install-version').innerHTML = list.map(v => `<option value="${esc(v.id)}">${esc(v.name)} · ${esc(v.game_versions.join(', '))} · ${esc(v.loaders.join(', '))}</option>`).join('') || '<option value="">No compatible versions</option>'; $('#install-project').disabled = !list.length || isBusy(); $('#install-note').textContent = list.length ? (pack ? 'Required client files and overrides are included. Optional client files are skipped.' : 'Required dependencies will be installed automatically.') : 'No compatible version is available for this selection.'; };
  let versionGeneration = 0;
  const compatible = async () => {
    const current = ++versionGeneration; const instanceId = $('#install-instance').value;
    versionOptionsFor([]); if (!instanceId) { $('#install-note').textContent = (project.project_type === 'mod' ? 'Create or select a Fabric, Quilt, or Forge instance to install mods.' : 'Create or select an instance to install this project.'); return; }
    const list = await api['project-versions']({ id, instanceId });
    if (generation !== modalGeneration || current !== versionGeneration) return;
    versionOptionsFor(list);
  };
  if (pack) versionOptionsFor(supported); else { $('#install-instance').addEventListener('change', () => run(compatible)); await compatible(); }
  if (generation !== modalGeneration) return;
  $('#install-project').addEventListener('click', e => { const versionId = $('#install-version').value; const instanceId = $('#install-instance')?.value; if (!versionId) return; run(async () => { closeModal(); if (pack) { const created = await api['pack-install'](versionId); selectedInstance = created.id; } else { await api['content-install']({ instanceId, versionId }); selectedInstance = instanceId; } await refresh(); page = 'instance'; render(); toast('Installation complete'); }, e.currentTarget); });
  redrawIcons();
}
async function closetModal() {
  const generation = showModal(`<div class="closet-preview"><span class="eyebrow">SKIN PREVIEW</span><canvas id="closet-canvas" aria-label="Selected skin preview"></canvas><h3 id="closet-name">Your character</h3><label class="field-label" for="skin-model">MODEL</label><select id="skin-model"><option value="default">Classic</option><option value="slim">Slim</option></select>${btn('Equip locally', 'equip-skin', 'check', 'primary', 'id="equip-skin" disabled')}</div><div class="closet-library">${modalHeader('Local closet', 'Choose, manage, and save your skins locally.', 'shirt')}<div class="closet-tools"><div class="search-input">${icon('search')}<input id="skin-search" placeholder="Search skins…" aria-label="Search skins"></div>${btn('New skin', 'import-skin', 'plus', 'primary')}</div><div id="skin-grid" class="skin-grid"></div><p class="closet-disclaimer">Skins are stored and previewed locally. Custom offline skins in-game require a compatible skin mod; this does not change your Microsoft skin.</p></div>`, 'closet-modal');
  const canvas = $('#closet-canvas');
  try { closetViewer = new SkinViewer({ canvas, width: 250, height: 330, skin: builtInSkin }); closetViewer.zoom = 0.8; closetViewer.controls.enableZoom = false; closetViewer.playerObject.rotation.y = -0.2; } catch { canvas.hidden = true; }
  const grid = $('#skin-grid'); let chosen = activeAccount()?.skinId || state.skins[0]?.id;
  const select = async id => { chosen = id; const skin = state.skins.find(s => s.id === id); if (!skin) return; const data = await skinData(id); if (generation !== modalGeneration) return; await closetViewer?.loadSkin(data, { model: skin.model }); $('#closet-name').textContent = skin.name; $('#skin-model').value = skin.model; $('#equip-skin').disabled = !activeAccount(); $('#equip-skin').dataset.id = id; $$('.skin-card').forEach(el => el.classList.toggle('selected', el.dataset.id === id)); };
  const draw = async (filter = '') => {
    const skins = state.skins.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()));
    const data = await Promise.all(skins.map(s => skinData(s.id)));
    if (generation !== modalGeneration) return;
    grid.innerHTML = skins.length ? skins.map((s, n) => `<div class="skin-card ${s.id === chosen ? 'selected' : ''}" data-id="${s.id}"><button class="skin-select" data-skin-id="${s.id}"><div class="skin-face" style="background-image:url('${data[n]}')"></div><span>${esc(s.name)}</span></button><div class="skin-card-actions">${btn('', 'export-skin', 'download', 'text-button', `data-id="${s.id}" aria-label="Export skin"`)}${btn('', 'delete-skin', 'trash-2', 'text-button', `data-id="${s.id}" aria-label="Delete skin"`)}</div></div>`).join('') : `<div class="empty-state">${icon('shirt')}<h3>${filter ? 'No matching skins' : 'A fresh look starts here.'}</h3><p>Import a 64×64 or 64×32 Minecraft skin PNG.</p></div>`;
    $$('[data-skin-id]').forEach(el => el.addEventListener('click', () => run(() => select(el.dataset.skinId)))); redrawIcons();
  };
  $('#skin-search').addEventListener('input', e => run(() => draw(e.target.value)));
  $('#skin-model').addEventListener('change', e => { if (closetViewer) closetViewer.playerObject.skin.modelType = e.target.value; });
  await draw(); if (chosen) await select(chosen);
}
async function manageContent(folder) {
  const item = instance(); const contents = await api['content-list'](item.id);
  showModal(`${modalHeader(`Manage ${folder}`, esc(item.name), 'puzzle')}<div class="file-list">${contents[folder].filter(f => !f.directory).map(f => `<div class="file-row"><span class="grow ${f.enabled ? '' : 'disabled-file'}">${esc(f.name)}</span>${btn(f.enabled ? 'Enabled' : 'Disabled', 'toggle-content', f.enabled ? 'check' : 'minus', 'secondary small-button', `data-folder="${folder}" data-name="${esc(f.name)}"`)}${btn('', 'remove-content', 'trash-2', 'square-button danger-text', `data-folder="${folder}" data-name="${esc(f.name)}" aria-label="Remove ${esc(f.name)}"`)}</div>`).join('') || '<div class="empty-state"><p>No files here yet. Install a project from Modrinth.</p></div>'}</div><div class="modal-footer">${btn('Open folder', 'content-folder', 'folder-open', 'secondary', `data-folder="${folder}"`)}</div>`, 'wide-modal');
}
function instanceSettings() {
  const item = instance(); showModal(`${modalHeader('Instance settings', esc(item.name), 'settings-2')}<form id="instance-settings-form"><label class="field-label" for="instance-name">NAME</label><input id="instance-name" value="${esc(item.name)}" maxlength="80" required><label class="field-label" for="instance-memory">MEMORY (MB)</label><input id="instance-memory" type="number" min="512" max="${state.totalMemory}" value="${item.memory || state.settings.memory}" required><p class="info-note">${icon('info')} Minecraft and loader versions stay fixed to protect this instance’s mods and saves. Create a new instance to use another version.</p><div class="modal-footer">${btn('Delete instance', 'delete-instance', 'trash-2', 'text-button danger-text', 'type="button"')}<button class="primary" type="submit">${icon('check')} Save changes</button></div></form>`);
  $('#instance-settings-form').addEventListener('submit', e => { e.preventDefault(); run(async () => { await api['instance-update']({ id: item.id, name: $('#instance-name').value, memory: Number($('#instance-memory').value) }); closeModal(); await refresh(); render(); }, $('button[type="submit"]', e.target)); });
}
async function showLogs() { const logs = await api.logs(); showModal(`${modalHeader('Game log', 'Live output from your current or most recent Minecraft session.', 'terminal')}<pre id="log-output">${esc(logs.join('\n') || 'No game output yet. Launch an instance to see its log here.')}</pre><div class="modal-footer">${selectedInstance ? btn('Open logs folder', 'content-folder', 'folder-open', 'secondary', 'data-folder="logs"') : ''}${btn('Close', 'close-modal', '', 'secondary')}</div>`, 'wide-modal'); const pre = $('#log-output'); pre.scrollTop = pre.scrollHeight; }
function updateStatus(s) {
  state.status = s; state.running = s.phase === 'running' ? s.instanceId : s.phase === 'idle' || s.phase === 'error' ? null : state.running;
  if (!$('#status-message')) return;
  $('#status-message').textContent = s.message;
  $('#status-dot').className = `status-dot ${s.phase}`;
  $('#status-percent').textContent = ['launching', 'installing'].includes(s.phase) ? `${s.percent || 0}%` : '';
  $('#progress-line').style.width = ['launching', 'installing'].includes(s.phase) ? `${Math.max(1, s.percent || 0)}%` : '0';
  $$('[data-action="launch"]').forEach(b => b.disabled = isBusy());
}
async function navigate(target) {
  closeModal(); searchGeneration++; page = target;
  if (page === 'market') market.type = 'modpack';
  if (page === 'mods' && market.type === 'modpack') market.type = 'mod';
  render();
}
const actions = {
  'news-post': el => newsPost(el.dataset.id), 'news-link': el => api['news-link'](el.dataset.url),
  'previous-news': () => changeNews(newsIndex - 1), 'next-news': () => changeNews(newsIndex + 1),
  'select-news': el => changeNews(Number(el.dataset.index)),
  'toggle-news': () => { newsPaused = !newsPaused; paintNews(); startNewsCycle(); }, 'refresh-news': () => loadHero(true),
  nav: el => navigate(el.dataset.page), discover: () => navigate('market'), instance: el => { selectedInstance = el.dataset.id; return navigate('instance'); },
  create: createModal, 'close-modal': closeModal,
  login: async () => { state = await api['microsoft-add'](); render(); toast('Microsoft account added'); },
  'select-account': async el => { state = await api['account-select'](el.dataset.id); render(); },
  'remove-account': async el => { state = await api['account-remove'](el.dataset.id); render(); toast('Account removed from this launcher'); },
  launch: async el => { await api.launch(el.dataset.id || selectedInstance); await refresh(); render(); },
  stop: () => api.stop(),
  'folder-root': () => api.folder(), 'instance-folder': () => api.folder({ id: selectedInstance }),
  'content-folder': el => api.folder({ id: selectedInstance, folder: el.dataset.folder }),
  'instance-settings': instanceSettings,
  'delete-instance': async () => { if (await api['instance-delete'](selectedInstance)) { closeModal(); await refresh(); selectedInstance = null; navigate('home'); } },
  'manage-content': el => manageContent(el.dataset.folder),
  'toggle-content': async el => { const folder = el.dataset.folder; await api['content-toggle']({ id: selectedInstance, folder, name: el.dataset.name }); await manageContent(folder); await renderInstance(); },
  'remove-content': async el => { const folder = el.dataset.folder; await api['content-remove']({ id: selectedInstance, folder, name: el.dataset.name }); await manageContent(folder); await renderInstance(); },
  'browse-content': el => { market = { ...market, type: el.dataset.type, query: '', version: instance().minecraft, loader: el.dataset.type === 'mod' && instance().loader !== 'vanilla' ? instance().loader : '', offset: 0 }; navigate('mods'); },
  'filter-loader': el => { market.loader = market.loader === el.dataset.value ? '' : el.dataset.value; market.offset = 0; render(); },
  'filter-category': el => { market.category = market.category === el.dataset.value ? '' : el.dataset.value; market.offset = 0; render(); },
  'reset-filters': () => { market = { query: '', type: market.type, loader: '', version: '', category: '', sort: 'relevance', offset: 0 }; render(); },
  'content-type': el => { market.type = el.dataset.type; market.offset = 0; if (market.type !== 'mod') market.loader = ''; render(); },
  'previous-page': () => { market.offset = Math.max(0, market.offset - 20); search(); $('#main').scrollTop = 0; },
  'next-page': () => { market.offset += 20; search(); $('#main').scrollTop = 0; }, 'retry-search': search,
  project: el => projectModal(el.dataset.id), external: el => api.external(el.dataset.url),
  'pick-java': async () => { const file = await api['java-pick'](); if (file) { $('#java-path').value = file; $('#auto-java').checked = false; $('#java-path').disabled = false; } },
  closet: closetModal,
  'import-skin': async () => { const skin = await api['skin-import'](); if (skin) { await refresh(); await closetModal(); } },
  'equip-skin': async el => { state = await api['skin-equip']({ id: el.dataset.id, model: $('#skin-model').value }); closeModal(); render(); toast('Skin equipped in your local closet'); },
  'export-skin': el => api['skin-export'](el.dataset.id),
  'delete-skin': async el => { state = await api['skin-delete'](el.dataset.id); await closetModal(); },
  logs: showLogs,
  minimize: () => api.window('minimize'), maximize: () => api.window('maximize'), 'close-window': () => api.window('close'),
  quick: () => { showModal(`${modalHeader('Quick action', 'Where would you like to go?', 'search')}<div class="quick-actions">${btn('Create a game', 'create', 'plus', 'secondary')}${btn('Discover modpacks', 'discover', 'store', 'secondary')}${btn('Manage accounts', 'nav', 'users-round', 'secondary', 'data-page="accounts"')}${btn('Launcher settings', 'nav', 'settings', 'secondary', 'data-page="settings"')}${btn('Game log', 'logs', 'terminal', 'secondary')}</div>`); },
  help: () => showModal(`${modalHeader('A little help getting started', '', 'circle-help')}<div class="help-content"><h3>1. Make it yours</h3><p>Add a Microsoft account or create an offline username in Accounts.</p><h3>2. Find your game</h3><p>Create a Vanilla, Fabric, Quilt, or Forge instance, or install a modpack from Modrinth.</p><h3>3. Hit play</h3><p>The launcher downloads Minecraft and the Java version it needs on first launch. Installed games can then be played offline with an offline account.</p><h3>Mods & skins</h3><p>Open an instance to install and manage mods, resource packs, and shaders. The local closet stores skin PNGs for preview and export; in-game offline skins need a skin mod.</p><p class="muted">NeoForge packs are not supported by this launcher. Offline accounts cannot join online-mode servers. Microsoft sign-in requires ownership of Minecraft Java.</p></div>`)
};
document.addEventListener('click', e => { const link = e.target.closest('.post-body a[href]'); if (link) { e.preventDefault(); run(() => api['news-link'](link.href)); return; } const el = e.target.closest('[data-action]'); if (!el || el.disabled) return; const action = actions[el.dataset.action]; if (action) run(() => action(el), el.tagName === 'BUTTON' ? el : null); });
document.addEventListener('change', e => { if (e.target.dataset.filter) { market[e.target.dataset.filter] = e.target.value; market.offset = 0; search(); } });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); actions.quick(); }
  if (e.key === 'Escape') closeModal();
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#instance-filter, #market-search')?.focus(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Tab' && $('#modal-overlay')) { const focusable = $$('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]', $('#modal-overlay')); const first = focusable[0], last = focusable.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
});
async function init() {
  if (!api) { $('#app').innerHTML = '<div class="startup-error"><h1>R1FT Client is a desktop launcher.</h1><p>Run <code>npm start</code> from the project folder to open the Electron app.</p></div>'; return; }
  await refresh(); render();
  api.onProgress(updateStatus);
  api.onLog(line => { const output = $('#log-output'); if (output) { output.textContent = (output.textContent + '\n' + line).slice(-150000); output.scrollTop = output.scrollHeight; } });
  api.onRefresh(() => run(async () => { await refresh(); render(); }));
  api.versions().then(v => { manifest = v; if ($('#game-version')) $('#game-version').innerHTML = '<option value="">All versions</option>' + versionOptions(market.version); }).catch(() => {});
  loadHero();
  setInterval(() => { if (!document.hidden) loadHero(true); }, 15 * 60 * 1000);
}
init().catch(e => { $('#app').innerHTML = `<div class="startup-error"><h1>Unable to start R1FT Client</h1><p>${esc(e.message)}</p></div>`; });
