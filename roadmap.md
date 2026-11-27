- [x] Phase 1: undo/redo, page zoom, auto-saved drafts (PDF editor)
- [ ] Phase 2: saved stamp/signature, arrows & boxes, page numbers & watermark
- [ ] Phase 3: PDF to images, batch compress

- [x] Current request: removed formatting controls; preserved embedded source font, weight, size, colour and baseline; verified mobile edit/save and desktop reopen. Subsets missing new glyphs use the matching local fallback.
- [x] Current fix: preserve descriptor boldness even for unusable subsets and choose bold fallback faces from numeric weight; 34 tests passed and mobile edit/save plus desktop reopen retained weight 700.
