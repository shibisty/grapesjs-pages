import type { Editor } from 'grapesjs';

type Panel = ReturnType<Editor['Panels']['getPanels']>['models'][number];

/**
 * Commands of the usual "views" switcher buttons (Style Manager, Layers,
 * Blocks, Traits) across GrapesJS builds and presets.
 */
const SWITCH_CMD_RE = /^(open|show)-(sm|styles?|layers?|blocks?|tm|traits?)$/i;

/**
 * Finds the panel holding the view-switcher buttons — by the commands of its
 * buttons, not by id: the id differs between builds ('views' in the core,
 * 'panel-switcher' in the webpage tutorial…), and `.gjs-pn-buttons` is a
 * class every panel has. Falls back to well-known ids.
 */
export function findHostPanel(editor: Editor, panelId: string | null): Panel | undefined {
  const Panels = editor.Panels;
  if (panelId) return Panels.getPanel(panelId) || undefined;
  const byCommand = Panels.getPanels().find((p: Panel) =>
    (p.get('buttons') as any)?.some((b: any) => {
      const cmd = b.get('command');
      const cmdId = typeof cmd === 'string' ? cmd : b.id;
      return SWITCH_CMD_RE.test(cmdId || '') || SWITCH_CMD_RE.test(b.id || '');
    })
  );
  if (byCommand) return byCommand;
  return ['views', 'panel-switcher', 'options'].map((id) => Panels.getPanel(id)).find(Boolean) || undefined;
}

export type SidebarMode = 'inline' | 'floating';

/**
 * Where to mount the sidebar so it shows up where the other panels
 * (layers/styles/traits) are, not over the canvas:
 * explicit selector → `.gjs-pn-views-container` (core) → `.panel__right`
 * (webpage demo layouts) → floating over the right edge of the editor.
 */
export function findSidebarHost(editor: Editor, selector: string | null): { el: HTMLElement; mode: SidebarMode } {
  const c = editor.getContainer() as HTMLElement;
  if (selector) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return { el, mode: 'inline' };
    console.warn('[grapesjs-pages] sidebarContainer "%s" not found, falling back to auto-detection', selector);
  }
  const views = c.querySelector<HTMLElement>('.gjs-pn-views-container');
  if (views) return { el: views, mode: 'inline' };
  const right = c.querySelector<HTMLElement>('.panel__right');
  if (right) return { el: right, mode: 'inline' };
  return { el: c, mode: 'floating' };
}
