import { getBlob } from '../api.js';
import { EXCHANGE_FORMATS, exchangeFilename, exchangePath, type ExchangeFormat } from '../../shared/exchange/formats.js';

/** Fetch the glTF or MVR file of a saved Bühnenbild and hand it to the browser as a download. */
export async function downloadExchangeFile(workspaceId: string, sceneId: string, sceneName: string, format: ExchangeFormat): Promise<void> {
  const blob = await getBlob(exchangePath(workspaceId, sceneId, format));
  const url = URL.createObjectURL(new Blob([blob], { type: EXCHANGE_FORMATS[format].contentType }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = exchangeFilename(sceneName, sceneId, format);
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
