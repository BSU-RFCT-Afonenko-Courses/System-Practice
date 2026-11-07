/* Навигация курса: структура слайдов и история посещений, независимые от интерфейса. */
const NavigationModel = (function () {
  'use strict';
  /** @param {unknown} value */
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

  /** @template {CourseGroupingEntry} T
   * @param {T[]} entries
   * @param {string} fallback
   * @returns {CourseGrouping<T>} */
  function groupEntries(entries, fallback) {
    /** @type {CourseGrouping<T>["groups"]} */
    const groups = [];
    /** @type {CourseGrouping<T>["groups"][number] | undefined} */
    let current;
    const slides = entries.map((entry, index) => {
      if (!current || (index > 0 && entries[index - 1]?.isTitle) || (entry.section && entry.section !== current.title) || entry.sectionStart) {
        current = { index: groups.length, title: entry.section || fallback, start: index, slides: [] };
        groups.push(current);
      }
      const slide = Object.assign({}, entry, { index, group: current.index });
      current.slides.push(slide);
      return slide;
    });
    return { slides, groups };
  }

  /** @template {CourseCollectElement} T
   * @param {{getSlides(): T[], getIndices(slide: NoInfer<T>): {h: number, v?: number | undefined}}} deck
   * @param {Pick<CourseNavLabels, 'slide' | 'start' | 'material'>} labels
   * @returns {CourseGrouping<CourseSlideEntry<T>>} */
  function collect(deck, labels) {
    const visible = deck.getSlides().filter(slide => {
      if (Array.from(slide.children).some(child => child.tagName === 'SECTION')) return false;
      /** @type {CourseCollectAncestor | null} */
      let node = slide;
      while (node && node.tagName === 'SECTION') {
        if (node.getAttribute('data-visibility') === 'hidden') return false;
        node = node.parentElement;
      }
      // Режим прокрутки может оставить пустую бывшую группу без координат слайда.
      return Number.isFinite(deck.getIndices(slide).h);
    });
    const entries = visible.map((element, index) => {
      const heading = element.querySelector('h1,h2,h3,h4');
      const title = clean(heading && heading.textContent) || `${labels.slide} ${index + 1}`;
      const isTitle = element.id === 'title-slide';
      const sectionStart = !isTitle && !!heading && (heading.tagName === 'H1' || element.classList.contains('level1'));
      const clone = element.cloneNode(true);
      if ('querySelectorAll' in clone) clone.querySelectorAll('script,style,.speaker-notes').forEach(node => node.remove());
      const indices = deck.getIndices(element);
      return {
        element, title, h: indices.h, v: indices.v || 0,
        section: isTitle ? labels.start : (sectionStart ? title : null),
        sectionStart, isTitle,
        search: clean(clone.textContent).toLocaleLowerCase()
      };
    });
    return groupEntries(entries, labels.material);
  }

  /** @param {CourseSlide} slide @param {string} term */
  function findTarget(slide, term) {
    if (!term) return slide.element;
    const selector = 'p,li,pre,h1,h2,h3,h4,h5,h6,td,th,figcaption,summary';
    const matches = Array.from(slide.element.querySelectorAll(selector)).filter(node =>
      !node.closest('script,style,.speaker-notes') && clean(node.textContent).toLocaleLowerCase().includes(term));
    return matches.find(node => !matches.some(child => child !== node && node.contains(child))) || slide.element;
  }

  class VisitHistory {
    constructor(limit = 256) {
      this.limit = limit;
      /** @type {number[]} */
      this.entries = [];
      this.cursor = -1;
    }
    /** @param {number} index */
    record(index) {
      if (this.entries[this.cursor] === index) return;
      this.entries = this.entries.slice(0, this.cursor + 1);
      this.entries.push(index);
      if (this.entries.length > this.limit) this.entries.shift();
      this.cursor = this.entries.length - 1;
    }
    /** @param {number} direction */
    move(direction) {
      const target = this.cursor + direction;
      if (target < 0 || target >= this.entries.length) return null;
      this.cursor = target;
      return this.entries[target] ?? null;
    }
    /** @param {number} direction */
    canMove(direction) { const target = this.cursor + direction; return target >= 0 && target < this.entries.length; }
  }

  return { collect, groupEntries, VisitHistory, findTarget };
})();
/** @type {CourseNavModules} */
const navigationNamespace = globalThis.CourseNavigationModules = globalThis.CourseNavigationModules || {};
navigationNamespace.NavigationModel = NavigationModel;
if (typeof module === 'object' && module.exports) module.exports = NavigationModel;
