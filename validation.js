export function text(value, max, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw Object.assign(new Error(`Enter ${required ? '1' : '0'}–${max} characters.`), { status: 400 });
  return value.trim();
}
export function id(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value))) throw Object.assign(new Error('Invalid ID.'), { status: 400 });
  return Number(value);
}
export function image(value) {
  const input = text(value ?? '', 1000, false);
  if (!input) return '';
  if (/^\/api\/media\/[a-f0-9]{32}\.webp$/.test(input)) return input;
  try { const url = new URL(input); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch {}
  throw Object.assign(new Error('Images must use an HTTPS URL.'), { status: 400 });
}
export function price(value) {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(String(value))) throw Object.assign(new Error('Enter a valid price between 0 and 999999.99.'), { status: 400 });
  return Number(value);
}
