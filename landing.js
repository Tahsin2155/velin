// Landing page helpers: placeholder for screenshots that aren't added yet,
// and copy-to-clipboard buttons for browser-internal URLs.
(() => {
  document.querySelectorAll('.shot').forEach(shot => {
    const img = shot.querySelector('img');
    if (!img) return;
    const markMissing = () => shot.classList.add('missing');
    img.addEventListener('error', markMissing);
    if (img.complete && img.naturalWidth === 0) markMissing();
  });

  document.querySelectorAll('[data-copy]').forEach(btn => {
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = 'copied ✓';
      } catch {
        btn.textContent = 'copy failed';
      }
      setTimeout(() => { btn.textContent = label; }, 1600);
    });
  });

  // Guide: browser tabs (all panels stay visible if JS is off)
  document.querySelectorAll('[data-tabs]').forEach(box => {
    const tabs = [...box.querySelectorAll('[role="tab"]')];
    const panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));
    const show = i => {
      tabs.forEach((t, j) => { t.setAttribute('aria-selected', j === i); t.tabIndex = j === i ? 0 : -1; });
      panels.forEach((p, j) => { p.hidden = j !== i; });
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => show(i));
      t.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        show(n); tabs[n].focus();
      });
    });
    show(0);
  });

  // Guide: highlight the current section in the contents list
  const tocLinks = [...document.querySelectorAll('.toc a')];
  if (tocLinks.length) {
    const targets = tocLinks.map(a => document.getElementById(a.getAttribute('href').slice(1)));
    let queued = false;
    const update = () => {
      queued = false;
      let cur = 0;
      targets.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= 140) cur = i; });
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = targets.length - 1;
      tocLinks.forEach((l, i) => l.classList.toggle('on', i === cur));
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // Pretty URLs: when served over http(s) (e.g. GitHub Pages), show /guide instead of /guide.html.
  // The server already resolves both; this only tidies the address bar. Skipped for file:// previews.
  if (/^https?:$/.test(location.protocol) && /\.html$/.test(location.pathname)) {
    const pretty = location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    history.replaceState(null, '', pretty + location.search + location.hash);
  }

  // Contact form (Formspree). Sends as JSON-accepting AJAX so the visitor stays on the page.
  const form = document.getElementById('contact-form');
  if (form) {
    const status = document.getElementById('contact-status');
    const submit = form.querySelector('button[type="submit"]');
    const configured = !form.getAttribute('action').includes('YOUR_FORM_ID');
    const say = (msg, cls) => { status.textContent = msg; status.className = cls || ''; };

    if (!configured) {
      submit.disabled = true;
      say('The contact form isn\u2019t switched on yet.', 'err');
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!configured) return;
      submit.disabled = true;
      say('Sending\u2026');
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json' }
        });
        if (res.ok) {
          form.reset();
          say('Thanks \u2014 your message was sent.', 'ok');
        } else {
          const data = await res.json().catch(() => ({}));
          const detail = (data.errors || []).map(x => x.message).join(', ');
          say(detail || 'Something went wrong. Please try again.', 'err');
        }
      } catch {
        say('Couldn\u2019t send. Check your connection and try again.', 'err');
      } finally {
        submit.disabled = false;
      }
    });
  }
})();
