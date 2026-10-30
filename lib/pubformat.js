//  The formats the publish page offers, each the mark a page is published
//  under. A stored page from before marks has none: it reads as the reader
//  would show it, HTML when it starts with <, else gemtext.

import { renderAs } from './mesa.mjs'

export const FORMATS = ['gmi', 'html']

export const formatOf = (page) => {
  const f = renderAs(page.mark, page.body)
  return FORMATS.includes(f) ? f : page.mark
}
