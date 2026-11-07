// 本地假 OpenAI 兼容服务：永远秒回，用于隔离"客户端挂死"与"上游挂死"
// 第 1 次请求返回 tool_call，之后返回纯文本；每次请求体落盘供取证
import http from 'http';
import fs from 'fs';

let n = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    n++;
    try {
      const j = JSON.parse(body || '{}');
      fs.writeFileSync(
        `scripts/mock-req-${n}.json`,
        JSON.stringify(
          {
            seq: n,
            url: req.url,
            stream: j.stream,
            tool_choice: j.tool_choice ?? '(未传)',
            tools_count: j.tools?.length ?? 0,
            messages_count: j.messages?.length ?? 0,
            last_role: j.messages?.[j.messages.length - 1]?.role,
            full_body: j,
          },
          null,
          2
        )
      );
      console.log(`[mock] 请求#${n} tool_choice=${JSON.stringify(j.tool_choice)} stream=${j.stream} msgs=${j.messages?.length}`);
    } catch (e) {
      console.log('[mock] 解析/写盘失败', e.message);
    }

    const isFreshRun = (JSON.parse(body || '{}').messages?.length ?? 0) <= 2;

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    if (isFreshRun) {
      // 首次：返回一个 emit_director_intent 工具调用
      res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'emit_director_intent', arguments: '' } }] } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"action":"approve"}' } }] } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
    } else {
      // 之后：返回纯文本
      res.write(`data: ${JSON.stringify({ id: 'c2', object: 'chat.completion.chunk', created: 2, model: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content: '好的，工序已启动。' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'c2', object: 'chat.completion.chunk', created: 2, model: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
server.listen(9911, () => console.log('[mock] listening :9911'));
