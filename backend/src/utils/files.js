export function sanitizeFilename(name) {
  return String(name || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_');
}
