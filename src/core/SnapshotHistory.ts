/**
 * Undo/redo stack of serialized project snapshots for one page.
 *
 * GrapesJS' own UndoManager tracks live models, and those are thrown away
 * by every `loadProjectData()` (= every page switch), so the plugin keeps
 * whole-page snapshots instead. Snapshots are JSON strings: cheap equality
 * check, immune to later mutation.
 */
export class SnapshotHistory {
  private stack: string[];
  private index: number;

  constructor(initial: string, private readonly limit = 50) {
    this.stack = [initial];
    this.index = 0;
  }

  get current(): string {
    return this.stack[this.index];
  }

  get size(): number {
    return this.stack.length;
  }

  get position(): number {
    return this.index;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /**
   * Records a new state. Returns false when it equals the current one
   * (nothing really changed). Drops the redo branch.
   */
  push(snapshot: string): boolean {
    if (snapshot === this.current) return false;
    this.stack.length = this.index + 1;
    this.stack.push(snapshot);
    const max = Math.max(1, this.limit);
    while (this.stack.length > max) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  /** Moves by `dir` (-1 undo, +1 redo); returns the new snapshot or null. */
  step(dir: -1 | 1): string | null {
    const next = this.index + dir;
    if (next < 0 || next >= this.stack.length) return null;
    this.index = next;
    return this.stack[next];
  }

  /**
   * Replaces the current snapshot with the editor-normalized version of the
   * same state (GrapesJS may add defaults on load), so the next comparison
   * does not see a phantom change.
   */
  replaceCurrent(snapshot: string): void {
    this.stack[this.index] = snapshot;
  }
}
