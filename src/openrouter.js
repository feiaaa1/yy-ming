const MODEL = 'inclusionai/ming-image-0.1-design-layer';
const API_URL = 'https://openrouter.ai/api/v1/images';

export function buildPrompt(instruction, history = []) {
  const context = history.length ? `Previous user adjustments: ${history.slice(-4).join(' / ')}.\n` : '';
  return `${context}Current request: ${instruction}.\nDecompose the supplied image into exactly two aligned layers. Layer 1: the requested main subject only, as a complete RGBA cutout at its original position and scale; everything else must have alpha=0. Preserve fine edges, holes, spokes, and transparent gaps. Do not add a white or solid-color matte. If the user requests a white background, still return transparent Layer 1; the application will place it on white afterward. Layer 2: the remaining background and other objects. Return Layer 1 first. Do not invent or redraw the subject.`;
}

export async function generateCutout({ apiKey, reference, instruction, history = [], signal }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Ming Cutout',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: buildPrompt(instruction, history),
      output_format: 'png',
      input_references: [{ type: 'image_url', image_url: { url: reference } }],
    }),
  });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { result = {}; }
  if (!response.ok) throw new Error(result?.error?.message || result?.message || raw.slice(0, 180) || `HTTP ${response.status}`);
  if (!Array.isArray(result.data) || !result.data.length) throw new Error('模型没有返回图片。');
  return result.data.map((item) => {
    if (!item.b64_json) throw new Error('模型返回了无法读取的图片。');
    const mime = item.media_type || 'image/png';
    const extension = mime.includes('webp') ? 'webp' : mime.includes('jpeg') ? 'jpg' : 'png';
    return { dataUrl: `data:${mime};base64,${item.b64_json}`, mime, extension };
  });
}
