/* Type shims for the vendored QR encoder (src/vendor/qrcode, MIT).
   The files are CommonJS bundled by esbuild; these declarations keep tsc happy. */
declare module "*/vendor/qrcode/lib/core/qrcode.js" {
  interface QrModules {
    size: number;
    data: ArrayLike<number>;
  }
  interface QrData {
    modules: QrModules;
  }
  const core: {
    create(data: string | ArrayLike<number>, options?: Record<string, unknown>): QrData;
  };
  export default core;
}

declare module "*/vendor/qrcode/lib/renderer/svg-tag.js" {
  const renderer: {
    render(
      qrData: { modules: { size: number; data: ArrayLike<number> } },
      options?: Record<string, unknown>,
      cb?: (err: Error | null, svg: string) => void,
    ): string;
  };
  export default renderer;
}
