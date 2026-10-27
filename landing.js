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
