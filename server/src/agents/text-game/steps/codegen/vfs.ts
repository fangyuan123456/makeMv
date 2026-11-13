/**
 * agents/text-game/steps/codegen/vfs.ts
 * 代码生成期的内存文件系统：模型先写进内存，落盘与拼接由工序决定。
 *
 * 存在的理由：多轮生成需要「已有什么文件、哪些符号已就绪」的即时视图，
 * 每写一个文件就读一次磁盘既慢又容易读到半截内容。
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
