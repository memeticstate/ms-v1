// Share next-themes preference without altering it.
try {
  const theme = localStorage.getItem('theme');
  const light = theme === 'light' || ((!theme || theme === 'system') && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.classList.toggle('light', light);
} catch { document.documentElement.classList.toggle('light', matchMedia('(prefers-color-scheme: light)').matches); }
