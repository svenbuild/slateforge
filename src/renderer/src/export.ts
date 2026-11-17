import template from '../../../assets/page-style.html?raw'

// The house style for HTML pages lives in assets/page-style.html, so agents
// and the app use the very same rules.
const PAGE_CSS = /<style>([\s\S]*?)<\/style>/.exec(template)?.[1] ?? ''

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string)
}

// A complete HTML document in the house style. The rule in the head lets it
// use nothing but its own styles and embedded images: no scripts, no files,
// no forms, nothing from the internet. Links open in a new window. A page
// must not send the reader somewhere by itself either, so that tag is removed.
export function pageDocument(title: string, body: string): string {
  const safeBody = body.replace(/<meta\b[^>]*http-equiv[^>]*>/gi, '')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'"><base target="_blank"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body>${safeBody}</body></html>`
}
