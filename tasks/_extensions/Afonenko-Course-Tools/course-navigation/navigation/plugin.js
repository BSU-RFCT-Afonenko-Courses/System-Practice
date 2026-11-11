/* Плагин Reveal. Файлы model.js и ui.js загружаются перед ним. */
(function (root) {
  'use strict';
  /** @type {Map<CourseReveal, () => void>} */
  const cleanup = new Map();
  /** @param {CourseNavigationOptions} options */
  function contextualLinks(options) {
        const context = document.getElementById('course-navigation-context');
        if (context) {
          /** @type {unknown} */ const data = JSON.parse(context.textContent || 'null');
          if (!data || typeof data !== 'object' || !('links' in data) || !Array.isArray(data.links)) throw new TypeError('Некорректный контекст навигации');
          /** @type {CourseNavLink[]} */ const links = [];
          /** @type {unknown[]} */ const rawLinks = data.links;
          for (const item of rawLinks) {
            if (!item || typeof item !== 'object' || !('text' in item) || typeof item.text !== 'string' || !('href' in item) || typeof item.href !== 'string') throw new TypeError('Некорректная ссылка навигации');
            const id = 'id' in item ? item.id : undefined;
            const current = 'current' in item ? item.current : undefined;
            const scope = 'scope' in item ? item.scope : undefined;
            if ((id !== undefined && typeof id !== 'string') || (current !== undefined && typeof current !== 'boolean') ||
              (scope !== undefined && typeof scope !== 'string')) throw new TypeError('Некорректная ссылка навигации');
            links.push({text: item.text, href: item.href, ...(id === undefined ? {} : {id}),
              ...(current === undefined ? {} : {current}), ...(scope === undefined ? {} : {scope})});
          }
          options.links = [...links, ...(options.links || [])];
        }
  }
  root.CourseNavigation = {
    id: 'CourseNavigation',
    init(deck) {
      const config = deck.getConfig();
      const configured = config.courseNav ?? config['course-nav'] ?? {};
      const printMode = config.view === 'print' || new URLSearchParams(location.search).has('print-pdf') || document.documentElement.classList.contains('print-pdf');
      // Подготовку содержимого к печати выполняют Quarto и course-presentation.
      if (printMode) return;
      if (configured === false) return;
      // Reveal удаляет скрытые разделы после инициализации плагина, до ready.
      // Координаты собираются после удаления, чтобы переходы были корректными.
      const start = () => {
        /** @type {CourseNavigationOptions} */
        const options = { language: document.documentElement.lang?.startsWith('en') ? 'en' : 'ru', sidebar: true, title: document.querySelector('#title-slide h1')?.textContent?.trim() || document.title, ...configured };
        contextualLinks(options);
        options.slideWidth = config.width; options.slideHeight = config.height;
        const { NavigationModel: Model, NavigationUI: UI } = root.CourseNavigationModules || {};
        if (!Model || !UI) throw new Error('Модули навигации не загружены');
        const model = Model.collect(deck, UI.strings[options.language || 'ru'] || UI.strings.ru);
        const history = new Model.VisitHistory();
        /** @type {number | null} */
        let historyTarget = null;
        /** @type {CourseNavUI} */
        let ui;
        const current = () => model.slides.find(slide => slide.element === deck.getCurrentSlide());
        /** @param {number} index @param {Element} [target] */
        function goto(index, target) {
          const slide = model.slides[index];
          if (!slide) return;
          const indices = deck.getIndices(slide.element);
          deck.slide(indices.h, indices.v || 0, -1);
          if (target) root.CourseDisclosure?.expose(target);
        }
        function update() {
          const slide = current();
          if (slide) {
            if (historyTarget !== slide.index) history.record(slide.index);
            historyTarget = null;
          }
          if (ui) ui.update(slide, history, deck.availableFragments());
        }
        /** @param {number} direction */
        function travel(direction) {
          const target = history.move(direction);
          if (target === null) return;
          historyTarget = target; goto(target);
          ui.update(current(), history, deck.availableFragments());
        }
        /** @param {number} direction */
        function section(direction) {
          const slide = current();
          const group = slide && model.groups[slide.group + direction];
          if (group) goto(group.start);
        }
        /** @type {CourseNavActions} */
        const actions = {
          goto, prev: () => deck.prev(), next: () => deck.next(),
          prevSection: () => section(-1), nextSection: () => section(1),
          back: () => travel(-1), forward: () => travel(1),
          print: () => {
            const url = new URL(location.href); url.searchParams.set('print-pdf', ''); url.hash = '';
            root.open(url.href, '_blank', 'noopener');
          },
          fullscreen: async () => {
            try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
            catch (_) { /* Внешний фрейм может запрещать полноэкранный режим. */ }
          }
        };
        const notes = deck.getPlugin?.('notes');
        if (typeof notes?.open === 'function') actions.speaker = () => notes.open?.();
        document.body.classList.add('course-navigation-active');
        if (options.sidebar === false) document.body.classList.add('course-navigation-no-sidebar');
        ui = UI.build(model, options, actions);
        const modeChanged = () => {
          if (document.body.dataset.courseMode === 'lecture') {
            ui.closeDialogs();
            ui.update(current(), history, deck.availableFragments());
            const toggle = document.querySelector('.course-mode-toggle');
            if (toggle instanceof HTMLElement) toggle.focus({preventScroll: true});
          }
          requestAnimationFrame(() => deck.layout());
        };
        document.addEventListener('course-mode-change', modeChanged);
        modeChanged();
        const overviewShown = () => {
          const showOverview = actions.overview;
          if (!showOverview) throw new Error('Обзор навигации не зарегистрирован');
          deck.toggleOverview(false); showOverview();
        };
        deck.on('overviewshown', overviewShown);
        if (!document.documentElement.requestFullscreen) ui.shell.querySelectorAll('[data-action="fullscreen"]').forEach(control => { if (control instanceof HTMLElement) control.hidden = true; });
        const changed = () => update();
        ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden'].forEach(event => deck.on(event, changed));
        const onResize = () => { deck.layout(); ui.update(current(), history, deck.availableFragments()); };
        root.addEventListener('resize', onResize);
        const beforePrint = () => { document.body.classList.add('course-navigation-print'); deck.layout(); };
        const afterPrint = () => { document.body.classList.remove('course-navigation-print'); deck.layout(); };
        root.addEventListener('beforeprint', beforePrint); root.addEventListener('afterprint', afterPrint);
        update(); requestAnimationFrame(() => deck.layout());
        cleanup.set(deck, () => {
          ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden'].forEach(event => deck.off(event, changed));
          root.removeEventListener('resize', onResize); root.removeEventListener('beforeprint', beforePrint); root.removeEventListener('afterprint', afterPrint);
          document.removeEventListener('course-mode-change', modeChanged);
          deck.off('ready', start);
          deck.off('overviewshown', overviewShown);
          ui.destroy(); document.body.classList.remove('course-navigation-active', 'course-navigation-no-sidebar', 'course-navigation-print');
        });
      };
      if (deck.isReady()) start();
      else {
        deck.on('ready', start);
        cleanup.set(deck, () => deck.off('ready', start));
      }
    },
    destroy() { cleanup.forEach(dispose => dispose()); cleanup.clear(); }
  };
})(window);
