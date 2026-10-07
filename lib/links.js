//  The links content.js makes of page text: urb:// addresses and furum's
//  f/~host/board shorthand. A classic script, not a module, since content
//  scripts cannot be modules: it defines one function, which content.js
//  calls and the tests load with node's vm.
//
//  The patterns are Talon's (io.nisfeb.talon.urbit): UrbLink.kt for urb://
//  and FurumLink.kt for the shorthand, and both open where Talon opens
//  them, on the reader's own ship: an urb:// address in lattice's reader
//  (UrbHttp.readerUrl), a board or a post in furum (FurumRef.pageUrl).

//  Every link in the text `page`, left to right and not overlapping, as
//  {start, end, text, href, web}: `href` is what the link opens, `web` the
//  same address on the ship at `origin` ('' when there is none). An urb://
//  link keeps its own address, for whatever handles urb:// here (Lattice,
//  Talon on the desktop); a shorthand has no address but the ship's, so
//  without a ship it stays text.
function urbitLinks(page, origin = '') {
  const text = String(page)
  const found = []
  //  urb:// and a run of anything but whitespace, quotes, angle brackets
  //  and backticks, less trailing sentence punctuation and a closing paren
  //  the run never opened.
  for (const m of text.matchAll(/urb:\/\/[^\s<>"'`]+/g)) {
    let end = m.index + m[0].length
    while (end > m.index) {
      const c = text[end - 1]
      if ('.,;:!?'.includes(c) || (c === ')' && !text.slice(m.index, end).includes('('))) end--
      else break
    }
    if (end - m.index <= 'urb://'.length) continue
    const addr = text.slice(m.index, end)
    const web = origin ? `${origin}/apps/lattice?url=${encodeURIComponent(addr)}` : ''
    found.push({ start: m.index, end, text: addr, href: addr, web })
  }
  //  f/~host/board[/42]: not inside a word, a path or a URL, and not
  //  running on into one. A board is a @tas, so `f/~zod/cats-` is cats.
  if (origin) {
    const short = /(?<![\w/~.-])f\/(~[a-z]+(?:-[a-z]+)*)\/([a-z](?:[a-z0-9-]*[a-z0-9])?)(?:\/(\d+))?(?![\w/])/g
    for (const m of text.matchAll(short)) {
      const [, host, board, post] = m
      const href = `${origin}/apps/furum/b/${host}/${board}${post ? `/${post}` : ''}`
      found.push({ start: m.index, end: m.index + m[0].length, text: m[0], href, web: '' })
    }
  }
  //  Where two overlap the first to start wins, as in Talon's renderer.
  found.sort((a, b) => a.start - b.start)
  let last = 0
  return found.filter((f) => (f.start >= last ? ((last = f.end), true) : false))
}
