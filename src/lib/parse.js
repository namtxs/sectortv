/**
 * Parse the `const streams = [ ... ]` array embedded in an xyzstreams page.
 *
 * The array is a JS object literal (unquoted keys, trailing commas, comments),
 * so we extract it by brace-matching and read fields with focused regexes
 * instead of JSON.parse.
 */

const FIELD = (key) => new RegExp(key + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');

function field(block, key) {
  const m = block.match(FIELD(key));
  return m ? m[1].replace(/\\"/g, '"') : '';
}

/** Extract every stream object, regardless of host. */
export function parseStreams(html) {
  const anchor = html.indexOf('const streams');
  if (anchor < 0) return [];

  const arrStart = html.indexOf('[', anchor);
  if (arrStart < 0) return [];

  // Brace/bracket match to find the end of the array literal.
  let depth = 0;
  let end = -1;
  for (let i = arrStart; i < html.length; i++) {
    const c = html[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];

  const body = html.slice(arrStart, end + 1);
  const objects = body.match(/\{[^{}]*\}/g) || [];

  return objects
    .map((o) => ({
      server: field(o, 'server'),
      btnName: field(o, 'btnName'),
      title: field(o, 'title'),
      type: field(o, 'type') || 'hls',
      file: field(o, 'file'),
      embedUrl: field(o, 'embedUrl'),
      streamId: field(o, 'streamId')
    }))
    .filter((s) => s.file || s.embedUrl || s.streamId);
}

/**
 * Produce a clean, readable channel name:
 * drops flag/emoji glyphs, normalises the Cyrillic "к" used in "4к",
 * and tidies whitespace. Falls back from title -> btnName.
 */
export function cleanName(stream) {
  let n = (stream.title || stream.btnName || '').toString();

  // "4к" / "4К" (Cyrillic) -> "4K"
  n = n.replace(/4[\u043a\u041a]/g, '4K');

  // Remove regional-indicator flags, emoji and misc symbols.
  n = n
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/[\uFE0F\u200D]/g, '');

  // Drop the redundant "(HLS)" tag — every stream here is HLS.
  n = n.replace(/\(\s*hls\s*\)/gi, '');

  // Drop any leftover non-printable / stray symbols, keep letters/digits/()/-/.
  n = n.replace(/[^\w\s().+\-/&]/g, ' ');

  return n.replace(/\s+/g, ' ').trim() || 'Channel';
}
