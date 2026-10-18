// Dev helper: index.html?samples replaces the session with all sample screenshots (needs a
// browser started with --allow-file-access-from-files when opened from file://, or any http
// server). ?samples=N selects the N-th image (1-based) after loading.
(() => {
  const s = document.createElement('script');
  s.src = 'tools/samples.js';
  s.onload = async () => {
    const files = await Promise.all(window.SAMPLES.map(smp => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        c.getContext('2d').drawImage(im, 0, 0);
        c.toBlob(b => res(new File([b], smp.file, { type: 'image/png' })), 'image/png');
      };
      im.onerror = rej;
      im.src = 'samples/' + smp.file;
    })));
    await App.docs.clear();
    await App.loaders.loadFiles(files);
    const n = parseInt(new URLSearchParams(location.search).get('samples'), 10);
    if (n > 0 && App.docs.list()[n - 1]) App.docs.setActive(App.docs.list()[n - 1].id);
    document.body.dataset.demoReady = '1';
    // Diagnostics for headless checks: canvas size and a pixel from its centre.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const cv = document.getElementById('view'), ctx = cv.getContext('2d');
      const p = ctx.getImageData(cv.width >> 1, cv.height >> 1, 1, 1).data;
      document.body.dataset.demoCanvas = `${cv.width}x${cv.height} centre=${[...p].join(',')}`;
    }));
  };
  document.head.appendChild(s);
})();
