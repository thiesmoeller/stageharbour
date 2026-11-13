# Third-party notices

StageHarbour includes data derived from the following third-party work. Dependencies installed
through npm carry their own licence files in `node_modules`.

## Pascal material library and model catalogue

`src/client/stage/materialLibrary.data.ts` and `src/client/stage/modelCatalog.data.ts` are generated
by `scripts/vendor-pascal-assets.ts` from `MATERIAL_CATALOG` in `@pascal-app/core` 1.0.6 and
`CATALOG_ITEMS` in `@pascal-app/editor` 1.0.6: ids, labels, categories, tags, material properties,
dimensions and the paths of textures, thumbnails and models.

Only this metadata is vendored. The textures, thumbnails and models themselves are not part of
StageHarbour; the app loads them at runtime from the hosts named in `src/shared/assetHosts.ts`
(`editor.pascal.app` and Pascal's public Supabase storage bucket). The licence below covers the
packages the metadata was taken from. It does not state terms for the hosted files.

```
MIT License

Copyright (c) 2026 Pascal Group Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
