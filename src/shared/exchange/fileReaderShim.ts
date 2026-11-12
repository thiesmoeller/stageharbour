type ReaderLike = {
  result: ArrayBuffer | string | null;
  onloadend: (() => void) | null;
  readAsArrayBuffer(blob: Blob): void;
  readAsDataURL(blob: Blob): void;
};

/**
 * three.js GLTFExporter merges its buffers through `Blob` and `FileReader`. Node has `Blob` but
 * no `FileReader`, so the server and the tests get the two methods the exporter calls. Browsers
 * already have one and are left alone.
 */
export function ensureFileReader(): void {
  const scope = globalThis as { FileReader?: unknown };
  if (typeof scope.FileReader !== 'undefined') return;
  class NodeFileReader implements ReaderLike {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then(buffer => this.finish(buffer));
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(buffer => {
        this.finish(`data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`);
      });
    }
    private finish(result: ArrayBuffer | string) {
      this.result = result;
      this.onloadend?.();
    }
  }
  scope.FileReader = NodeFileReader;
}
