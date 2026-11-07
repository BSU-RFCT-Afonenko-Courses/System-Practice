/* Локальные ссылки @sol / @tip работают без каталога ссылок.
 * Межпроектные переходы обрабатывает QRC; совместная обработка допускает повтор.
 * Notes и поиск используют ту же операцию раскрытия целевого блока. */
(() => {
  'use strict';
  /** @param {string} hash */
  function targetForHash(hash) {
    try { return document.getElementById(decodeURIComponent(hash.replace(/^#\/?/, ''))); }
    catch { return null; }
  }
  /** @param {Element | null} target */
  function expose(target) {
    if (!target) return;
    const displayed = window.CoursePresentation?.exposeNote(target);
    if (displayed) target = displayed;
    const exposed = target;
    let fragment = -1;
    const scroll = () => {
      if (!window.Reveal) {
        // Начало длинного раздела должно оставаться видимым. Отступ под
        // навигационную панель задаёт штатное оформление Quarto для :target.
        const block = exposed.tagName === 'SECTION' ? 'start' : 'center';
        exposed.scrollIntoView({block, behavior: 'auto'});
      }
    };
    /** @type {Element | null} */
    let element = exposed;
    for (; element; element = element.parentElement) {
      if (element instanceof HTMLDetailsElement) element.open = true;
      if (element.classList.contains('collapse') && !element.classList.contains('show')) {
        if (window.bootstrap?.Collapse) {
          element.addEventListener('shown.bs.collapse', scroll, {once: true});
          window.bootstrap.Collapse.getOrCreateInstance(element, {toggle: false}).show();
        }
        else {
          element.classList.add('show');
          const callout = element.closest('.callout');
          callout?.querySelectorAll('[data-bs-toggle="collapse"]').forEach((control) => {
            control.setAttribute('aria-expanded', 'true'); control.classList.remove('collapsed');
          });
        }
      }
      if (element.classList.contains('fragment')) {
        const index = Number(element.getAttribute('data-fragment-index'));
        if (Number.isFinite(index)) fragment = Math.max(fragment, index);
      }
    }
    window.requestAnimationFrame(scroll);
    const reveal = window.Reveal;
    if (reveal?.isReady() && fragment >= 0) {
      const slide = target.closest('section.slide');
      if (slide) {
        const position = reveal.getIndices(slide);
        reveal.slide(position.h, position.v, fragment);
      }
    }
  }
  function onHash() { expose(targetForHash(window.location.hash)); }
  window.CourseDisclosure = {expose};
  function initialize() {
    document.addEventListener('click', (event) => {
      // Quarto обрабатывает якоря Reveal с preventDefault; цель раскрывается
      // после этого обработчика, сохраняя жесты открытия в новой вкладке.
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
      const href = link?.getAttribute('href');
      if (href) window.requestAnimationFrame(() => expose(targetForHash(href)));
    });
    window.addEventListener('hashchange', onHash);
    if (window.Reveal && !window.Reveal.isReady()) window.Reveal.on('ready', onHash);
    onHash();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once: true});
  else initialize();
})();
