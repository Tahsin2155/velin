// Home page behavior: mobile menu, scroll reveals, the word by word tagline, and nav highlighting.
// Everything uses IntersectionObserver, so there is no scroll listener doing work on every frame.
(() => {
  const root = document.documentElement;

  // ── mobile menu ──
  const nav = document.getElementById('nav');
  const toggle = nav && nav.querySelector('.menu-toggle');
  if (nav && toggle) {
    const setOpen = open => {
      nav.classList.toggle('open', open);
      root.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    nav.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); }
    });
    matchMedia('(min-width: 768px)').addEventListener('change', e => { if (e.matches) setOpen(false); });
  }

  // ── scroll reveals: each block rises once, then stays ──
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('in'));
  }

  // ── tagline: words go from muted to full color one at a time ──
  const tagline = document.getElementById('tagline-text');
  if (tagline && 'IntersectionObserver' in window) {
    const words = tagline.textContent.trim().split(/\s+/);
    tagline.setAttribute('aria-label', words.join(' '));
    tagline.textContent = '';
    const spans = words.map((word, i) => {
      const span = document.createElement('span');
      span.className = 'w';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = word;
      tagline.appendChild(span);
      if (i < words.length - 1) tagline.appendChild(document.createTextNode(' '));
      return span;
    });

    // Words on the same line cross the trigger line together, so stagger them left to right.
    const stagger = () => {
      let lineTop = null, n = 0;
      spans.forEach(span => {
        const top = span.offsetTop;
        if (lineTop === null || Math.abs(top - lineTop) > 2) { lineTop = top; n = 0; }
        span.style.setProperty('--d', Math.min(n * 45, 270) + 'ms');
        n++;
      });
    };
    stagger();
    let resizeQueued = false;
    addEventListener('resize', () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => { resizeQueued = false; stagger(); });
    });

    // A word turns on when it rises above a line 35% up from the bottom of the screen.
    // Words already scrolled past (for example after jumping to a later section) turn on too.
    const wordIO = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
          entry.target.classList.add('on');
          wordIO.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -35% 0px' });
    spans.forEach(span => wordIO.observe(span));
  }

  // ── nav: mark the section currently in view ──
  const links = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const targets = [...byId.keys()].map(id => document.getElementById(id)).filter(Boolean);
  if (targets.length && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const link = byId.get(entry.target.id);
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach(a => a.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'location');
        } else if (link.getAttribute('aria-current')) {
          link.removeAttribute('aria-current');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    targets.forEach(t => spy.observe(t));
  }
})();
