import template from '../../assets/page-style.html?raw'

// The house style for HTML pages lives in assets/page-style.html, so agents
// and the app use the very same rules.
const PAGE_CSS = /<style>([\s\S]*?)<\/style>/.exec(template)?.[1] ?? ''

// What a page may do: run its own scripts and styles and show embedded
// images. It may not load anything from the internet or from disk and may not
// send forms, so nothing written on a page can leave the computer.
export const PAGE_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'"

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string)
}

// A complete HTML document in the house style. Links open in a new window. A
// page must not send the reader somewhere by itself, so that tag is removed.
export function pageDocument(title: string, body: string): string {
  const safeBody = body.replace(/<meta\b[^>]*http-equiv[^>]*>/gi, '')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><base target="_blank"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body>${safeBody}</body></html>`
}
