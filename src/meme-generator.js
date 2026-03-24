function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(text, lineLength = 18) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return ['...'];
  }

  const lines = [];
  for (let index = 0; index < normalized.length; index += lineLength) {
    lines.push(normalized.slice(index, index + lineLength));
  }
  return lines.slice(0, 6);
}

function toDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function generateQuoteMeme({ username = 'user', text = '', avatarUrl = '' } = {}) {
  const lines = wrapText(text);
  const bubbleHeight = 40 + (lines.length * 26);
  const width = 720;
  const height = Math.max(180, bubbleHeight + 60);
  const lineMarkup = lines
    .map((line, index) => `<text x="170" y="${90 + (index * 26)}" font-size="24" fill="#1f2937">${escapeXml(line)}</text>`)
    .join('');
  const avatarLabel = escapeXml(String(username || 'user').slice(0, 2).toUpperCase());
  const avatarHint = avatarUrl ? `<text x="95" y="148" font-size="12" fill="#6b7280">avatar linked</text>` : '';

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f4f5f7"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="28" fill="#ffffff"/>
  <circle cx="95" cy="92" r="42" fill="#f59e0b"/>
  <text x="95" y="102" text-anchor="middle" font-size="26" fill="#ffffff">${avatarLabel}</text>
  ${avatarHint}
  <text x="170" y="54" font-size="20" fill="#6b7280">${escapeXml(username)}</text>
  <rect x="150" y="68" width="${width - 190}" height="${bubbleHeight}" rx="24" fill="#dbeafe"/>
  ${lineMarkup}
</svg>`.trim();

  return {
    type: 'image',
    format: 'svg',
    file: toDataUri(svg),
    width,
    height,
    text,
  };
}

export function generateAvatarCaptionMeme({ username = 'user', caption = '', avatarUrl = '' } = {}) {
  return generateQuoteMeme({
    username,
    text: caption,
    avatarUrl,
  });
}
