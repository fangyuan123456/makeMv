/**
 * tools/game-assembly/steps/02-codegen/vfs.ts
 * 虚拟文件系统 (VirtualFS)
 */

export class VirtualFS {
  private files = new Map<string, string>();

  hasFile(name: string): boolean {
    return this.files.has(name);
  }

  read(name: string): string | undefined {
    return this.files.get(name);
  }

  write(name: string, content: string): void {
    this.files.set(name, content);
  }

  remove(name: string): void {
    this.files.delete(name);
  }

  list(): string[] {
    return Array.from(this.files.keys());
  }

  get size(): number {
    return this.files.size;
  }

  entries(): Array<[string, string]> {
    return Array.from(this.files.entries());
  }
}
