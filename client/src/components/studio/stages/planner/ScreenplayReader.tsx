import React, { useRef } from 'react';

/** 剧本阅读格式：隐藏机器契约，保留分幕层次和可点击的段落去向。 */
export function ScreenplayReader({ markdown }: { markdown: string }) {
  const container = useRef<HTMLDivElement>(null);
  const inline = (line: string) => line.split(/(\[[^\]\n]+\]\(#[^\)\n]+\))/g).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(#([^\)]+)\)$/);
    return link ? <a key={index} href={`#${link[2]}`} className="text-indigo-700 underline underline-offset-2 hover:text-indigo-900" onClick={event => {
      event.preventDefault();
      const target = Array.from(container.current?.querySelectorAll('[id]') || []).find(element => element.id === link[2]);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }}>{link[1]}</a> : part;
  });
  const lines = markdown.replace(/<!--[^]*?-->/g, '').split(/\r?\n/);
  return <div ref={container} className="font-sans text-sm text-slate-800 leading-7">
    {lines.map((line, index) => {
      const anchor = line.match(/^<a id="([^"]+)"><\/a>$/);
      if (anchor) return <div key={index} id={anchor[1]} className="scroll-mt-4" />;
      if (!line.trim()) return null;
      if (line === '---') return <hr key={index} className="my-6 border-slate-200" />;
      if (line.startsWith('### ')) return <h3 key={index} className="mt-4 mb-3 text-sm font-semibold text-slate-900">{inline(line.slice(4))}</h3>;
      if (line.startsWith('## ')) return <h2 key={index} className="mt-6 mb-4 text-base font-semibold text-slate-900">{inline(line.slice(3))}</h2>;
      if (line.startsWith('# ')) return <h1 key={index} className="mb-5 text-lg font-semibold text-slate-900">{inline(line.slice(2))}</h1>;
      if (line.startsWith('> ')) return <p key={index} className="mb-4 border-l-2 border-indigo-200 pl-3 text-xs text-slate-500">{inline(line.slice(2))}</p>;
      return <p key={index} className={`mb-3 whitespace-pre-wrap ${/^\s*- /.test(line) ? 'pl-3' : ''}`}>{inline(line)}</p>;
    })}
  </div>;
}
