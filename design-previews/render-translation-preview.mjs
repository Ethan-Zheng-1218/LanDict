import { writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { House, Languages, BookOpen, StickyNote, GraduationCap, Settings, Search, Star, Volume2, ChevronDown } from 'lucide-react';

// Use Vite's real, compiled app stylesheet rather than inventing another shell.
const response = await fetch('http://127.0.0.1:5173/src/styles/app.css?direct');
if (!response.ok) throw new Error(`App CSS: ${response.status}`);
const css = (await response.text()).replaceAll('/src/assets/', '../src/assets/');
if (!css.includes('.query-page') || !css.includes('.app-sidebar')) throw new Error('Missing application styles');
const icon = (Icon, size = 20) => renderToStaticMarkup(createElement(Icon, { size, strokeWidth: 1.8, 'aria-hidden': true }));
const nav = [[House, '首页'], [Languages, '翻译'], [BookOpen, '阅读'], [StickyNote, '生词本'], [GraduationCap, '背单词']].map(([Icon, label]) => `<li><span class="nav-item items-center"${label === '翻译' ? ' data-active aria-current="page"' : ''}>${icon(Icon)}<span>${label}</span></span></li>`).join('');
const examples = [
  ['It was a positive miracle that we survived.', '我们能够生还，完全是个奇迹。'],
  ['The victory was nothing less than a miracle.', '这场胜利是个不折不扣的奇迹。'],
  ["It's a miracle (that) nobody was killed in the crash.", '撞车事故中竟然没有一人丧生，这真是奇迹。'],
].map(([en, cn]) => `<div><strong></strong><p class="dictionary-example-line always-stacked"><span>${en}</span><span class="dictionary-example-translation">${cn}</span></p></div>`).join('');
const collocations = [['economic miracle', '经济奇迹'], ['to a miracle', '奇妙地；好得不可思议；好到惊人程度；完全地'], ['by a miracle', '奇迹般地；依靠奇迹'], ['miracle drug', '特效药']].map(([en, cn]) => `<span>${en}<small class="dictionary-inline-translation">（${cn}）</small></span>`).join('');
const compactCss = `
/* Density adjustments only: shell, search, columns, order and alignment stay intact. */
html[data-density="compact"] .query-page .query-header-word h2 { font-size: 30px; }
html[data-density="compact"] .query-page .query-header { padding-block: 12px; }
html[data-density="compact"] .query-page .pronunciation-row { margin-top: 8px; }
html[data-density="compact"] .query-page .provider-name { font-size: 16px; }
html[data-density="compact"] .query-page .provider-panel-header { min-height: 44px; }
html[data-density="compact"] .query-page .provider-panel-toggle { padding: 8px 16px; }
html[data-density="compact"] .query-page .provider-panel-body { padding: 16px; }
html[data-density="compact"] .query-page .dictionary-meaning-group strong { font-size: 16px; }
html[data-density="compact"] .query-page .dictionary-meaning-group > span { font-size: 13px; }
html[data-density="compact"] .query-page .dictionary-entry p { font-size: 14px; line-height: 1.65; }
html[data-density="compact"] .query-page .dictionary-entry h3 { font-size: 14px; }
html[data-density="compact"] .query-page .dictionary-entry { gap: 12px; }
html[data-density="compact"] .query-page .dictionary-entry section { padding-top: 12px; }
html[data-density="compact"] .query-page .dictionary-usage { gap: 12px !important; }
html[data-density="compact"] .query-page .dictionary-usage > div { gap: 8px; }
html[data-density="compact"] .query-page .dictionary-examples > div { padding-block: 3px; }
`;
const html = `<!doctype html>
<html lang="zh-CN" data-theme="blue" data-density="compact">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LanDict · 翻译页字号与间距预览</title>
<style>${css}</style>
<style>${compactCss}</style>
<script>document.documentElement.dataset.density = new URLSearchParams(location.search).get('state') === 'original' ? 'original' : 'compact';</script>
</head>
<body>
<div id="root"><div class="app-frame">
  <div class="app-sidebar-provider flex min-h-svh w-full" style="--sidebar-width: var(--app-sidebar-width)">
    <aside class="app-sidebar flex h-full flex-col" style="width:var(--sidebar-width)" aria-label="主导航">
      <div class="app-sidebar-header flex flex-col gap-2 p-2"><div class="brand"><span class="brand-logo" aria-hidden="true"><img src="../public/brand/landict.png" alt=""></span><div><div class="brand-name">LanDict</div><div class="brand-tagline">Less is more</div></div></div></div>
      <div class="app-sidebar-content flex min-h-0 flex-1 flex-col"><nav><ul data-slot="sidebar-menu" class="flex w-full flex-col">${nav}</ul></nav><aside class="reading-outline-sidebar-slot"></aside></div>
      <div class="sidebar-settings flex flex-col gap-2 p-2"><ul data-slot="sidebar-menu" class="flex w-full flex-col"><li><span class="settings-link items-center">${icon(Settings)}<span>设置</span></span></li></ul></div>
    </aside>
  </div>
  <div class="app-workspace"><main class="app-content app-content-feature" id="content">
    <section class="query-page">
      <div class="query-controls"><form class="ui-search-box query-input-form" id="query-form" aria-label="翻译查询">
        ${icon(Search)}<div class="query-input-area"><div class="assisted-word-field"><textarea aria-label="重新查询" rows="1" id="query-input">miracle</textarea></div><span class="query-definition-preview">n. 圣迹</span></div><button class="ui-button ui-button--primary" type="submit">查询</button>
      </form></div>
      <header class="ui-page-header query-header query-header-word"><div class="ui-page-header-copy">
        <div class="ui-page-header-title-row"><h2>miracle</h2><div class="ui-page-header-actions"><button class="ui-button ui-button--ghost ui-button--sm save-word-button" id="save" type="button" aria-pressed="false">${icon(Star)}<span>加入生词本</span></button></div></div>
        <div class="pronunciation-row"><button class="ui-button ui-button--ghost ui-button--sm" type="button" data-accent="en-GB" title="系统语音朗读">${icon(Volume2, 16)}英 /ˈmɪrəkl/</button><button class="ui-button ui-button--ghost ui-button--sm" type="button" data-accent="en-US" title="系统语音朗读">${icon(Volume2, 16)}美 /ˈmɪrək(ə)l/</button></div>
      </div></header>
      <div class="provider-list">
        <article class="ui-card provider-panel expanded" id="dictionary">
          <div class="provider-panel-header" data-slot="card-header"><button class="provider-panel-toggle" type="button" aria-expanded="true" aria-controls="dictionary-body" aria-label="收起词库解释"><span class="provider-name">${icon(BookOpen)}词库解释</span><span class="provider-panel-summary">有道词典</span>${icon(ChevronDown)}</button></div>
          <div class="provider-panel-body" id="dictionary-body" data-slot="card-content"><div class="dictionary-candidate-list"><div class="dictionary-entry">
            <div class="dictionary-entry-summary"><div class="dictionary-meanings"><div class="dictionary-meaning-group"><span>n.</span><strong>奇迹；不可思议的事；杰出例子；精品</strong></div><div class="dictionary-meaning-group"><span>adj.</span><strong>不可思议的</strong></div><div class="dictionary-meaning-group"></div></div></div>
            <section class="dictionary-usage"><div><h3>常见例句</h3><div class="dictionary-examples">${examples}</div></div><div><h3>常见搭配</h3><div class="dictionary-collocations">${collocations}</div></div></section>
            <section><h3>词形变化</h3><div class="dictionary-collocations"><span>复数 miracles</span></div></section>
          </div></div></div>
        </article>
        <article class="ui-card provider-panel"><div class="provider-panel-header" data-slot="card-header"><div class="provider-panel-toggle query-ai-combined-header"><span class="provider-name">${icon(Languages)}AI 翻译</span>${icon(ChevronDown)}</div></div></article>
      </div>
    </section>
  </main></div>
</div></div>
<script>
document.querySelector('#query-form').addEventListener('submit', event => { event.preventDefault(); document.querySelector('#query-input').value = 'miracle'; });
document.querySelector('#save').addEventListener('click', event => { const button = event.currentTarget; const saved = button.getAttribute('aria-pressed') !== 'true'; button.setAttribute('aria-pressed', String(saved)); button.classList.toggle('saved', saved); button.querySelector('span').textContent = saved ? '已加入生词本' : '加入生词本'; });
document.querySelector('#dictionary .provider-panel-toggle').addEventListener('click', event => { const button = event.currentTarget; const expanded = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(expanded)); button.setAttribute('aria-label', (expanded ? '收起' : '展开') + '词库解释'); document.querySelector('#dictionary').classList.toggle('expanded', expanded); document.querySelector('#dictionary-body').hidden = !expanded; });
document.querySelectorAll('[data-accent]').forEach(button => { if (!('speechSynthesis' in window)) { button.disabled = true; return; } button.addEventListener('click', () => { speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance('miracle'); utterance.lang = button.dataset.accent; speechSynthesis.speak(utterance); }); });
</script>
</body></html>
`;
await writeFile(new URL('./translation-compact-preview.html', import.meta.url), html, 'utf8');
console.log('Generated translation preview with the actual app stylesheet and unchanged layout.');
