import { describe, expect, it } from 'vitest';
import { createEditor, destroyEditor } from './helpers/editor';

/*
 * GrapesJS debounces several selection handlers (SelectComponent.onSelect,
 * ClassTagsView.componentChanged). When the selection changes right before
 * editor.destroy() — which happens on a slow machine, e.g. a frame loading
 * late — they fired after the teardown, inside the next test:
 * "Cannot read properties of undefined (reading 'lastComponent')".
 * destroyEditor() must swallow that; Vitest fails the run on such an
 * unhandled error, so this test passing is the check.
 */
describe('destroyEditor', () => {
  it('a selection queued right before the teardown does not fire on a dead editor', async () => {
    const s = await createEditor();
    const ed = s.editor as unknown as { destroy: () => void; select: (c: unknown) => void };
    const origDestroy = ed.destroy.bind(ed);
    ed.destroy = () => {
      ed.select(s.editor.getWrapper()!.find('#title')[0]);
      origDestroy();
    };
    await destroyEditor(s.editor);
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector('.gjs-editor')).toBeNull();
  });
});
