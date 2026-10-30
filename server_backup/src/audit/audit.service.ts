import fs from 'fs';
import path from 'path';
import { WorkflowStage } from '../types/workflow.js';
import {
  AiCallRecord,
  StageTurnArchive,
  SessionAuditSummary,
  PromptPayload,
  getStageFolderPrefix,
} from './audit.types.js';

export class AgentAuditRecorder {
  private aiCalls: AiCallRecord[] = [];
  private startTime: number;
  private startIso: string;

  constructor(
    public readonly sessionId: string,
    public readonly stage: WorkflowStage,
    public readonly agentName: string,
    private readonly projectDir: string,
    private readonly userFeedback?: string,
    private readonly sessionMeta?: Record<string, any>,
    private readonly upstreamArtifacts?: Record<string, any>
  ) {
    this.startTime = Date.now();
    this.startIso = new Date().toISOString();
  }

  /**
   * Record a single AI call (LLM, image, video, etc.)
   */
  recordAiCall(call: Omit<AiCallRecord, 'callId' | 'timestamp'>): void {
    const record: AiCallRecord = {
      ...call,
      callId: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.aiCalls.push(record);
  }

  /**
   * 辅助函数：执行并记录大语言模型（LLM）的调用输入、输出与耗时
   */
  async trackLlmCall<T>(
    prompt: PromptPayload | string,
    model: string,
    fn: () => Promise<T>,
    callType: 'llm_chat' | 'llm_json' = 'llm_json'
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const res = await fn();
      this.recordAiCall({
        callType,
        model,
        prompt,
        rawResponse: res,
        durationMs: Date.now() - t0,
        status: 'success',
      });
      return res;
    } catch (err: any) {
      this.recordAiCall({
        callType,
        model,
        prompt,
        rawResponse: null,
        durationMs: Date.now() - t0,
        status: 'error',
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * 辅助函数：执行并记录文生图 API 调用的提示词与结果产物
   */
  async trackImageCall<T>(
    prompt: string,
    model: string,
    fn: () => Promise<T>,
    callType: 'image_t2i' | 'image_i2i' = 'image_t2i'
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const res = await fn();
      this.recordAiCall({
        callType,
        model,
        prompt: { userPrompt: prompt },
        rawResponse: res,
        durationMs: Date.now() - t0,
        status: 'success',
      });
      return res;
    } catch (err: any) {
      this.recordAiCall({
        callType,
        model,
        prompt: { userPrompt: prompt },
        rawResponse: null,
        durationMs: Date.now() - t0,
        status: 'error',
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * 完成当前执行轮次并写入项目 .agent_debug 审计目录
   */
  async finalize(options: {
    artifact?: any;
    status: 'success' | 'failed';
    stopPointTitle?: string;
    stopPointDescription?: string;
    error?: string;
  }): Promise<StageTurnArchive> {
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;

    const archive: StageTurnArchive = {
      archiveId: `turn_${this.stage}_${this.startTime}`,
      turnIndex: 1, // 后续由 auditService 自动计算更新
      sessionId: this.sessionId,
      stage: this.stage,
      agentName: this.agentName,
      startTime: this.startIso,
      endTime: new Date().toISOString(),
      durationMs,
      sessionMeta: this.sessionMeta,
      upstreamArtifacts: this.upstreamArtifacts,
      userFeedback: this.userFeedback,
      status: options.status,
      stopPointTitle: options.stopPointTitle,
      stopPointDescription: options.stopPointDescription,
      error: options.error,
      aiCalls: this.aiCalls,
      finalArtifact: options.artifact,
    };

    auditService.saveArchive(this.projectDir, archive);
    return archive;
  }
}

export class AgentAuditService {
  /**
   * 确保项目目录内存在 .agent_debug 审计文件夹
   */
  ensureDebugDir(projectDir: string): string {
    const debugDir = path.join(projectDir, '.agent_debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    return debugDir;
  }

  /**
   * 为特定阶段执行轮次创建审计记录器
   */
  createRecorder(
    sessionId: string,
    stage: WorkflowStage,
    agentName: string,
    projectDir: string,
    userFeedback?: string,
    sessionMeta?: Record<string, any>,
    upstreamArtifacts?: Record<string, any>
  ): AgentAuditRecorder {
    return new AgentAuditRecorder(
      sessionId,
      stage,
      agentName,
      projectDir,
      userFeedback,
      sessionMeta,
      upstreamArtifacts
    );
  }

  /**
   * 将轮次归档保存至 .agent_debug/{stagePrefix}/ 目录，
 * 显式持久化 input.json、output.json、prompts.json、raw_ai_response.json 及 trace.md 追踪日志
   */
  saveArchive(projectDir: string, archive: StageTurnArchive): void {
    const debugDir = this.ensureDebugDir(projectDir);
    const stageFolder = getStageFolderPrefix(archive.stage);
    const stageDir = path.join(debugDir, stageFolder);
    if (!fs.existsSync(stageDir)) {
      fs.mkdirSync(stageDir, { recursive: true });
    }

    // 计算当前轮次序号
    const existingTurns = fs.readdirSync(stageDir).filter((f) => f.startsWith('turn_') && f.endsWith('.json'));
    archive.turnIndex = existingTurns.length + 1;

    // 1. 明确写入 Agent 的输入内容归档: input.json
    const inputPayload = {
      stage: archive.stage,
      agentName: archive.agentName,
      turnIndex: archive.turnIndex,
      startTime: archive.startTime,
      sessionId: archive.sessionId,
      userIdea: archive.sessionMeta?.idea || null,
      userStyle: archive.sessionMeta?.style || null,
      userFeedback: archive.userFeedback || null,
      upstreamArtifacts: archive.upstreamArtifacts || {},
      sessionMeta: archive.sessionMeta || {},
    };
    fs.writeFileSync(path.join(stageDir, 'input.json'), JSON.stringify(inputPayload, null, 2), 'utf-8');

    // 2. 明确写入发送给 AI 的提示词归档: prompts.json
    const promptsPayload = archive.aiCalls.map((call, idx) => ({
      callIndex: idx + 1,
      callType: call.callType,
      model: call.model,
      durationMs: call.durationMs,
      status: call.status,
      prompt: call.prompt,
    }));
    fs.writeFileSync(path.join(stageDir, 'prompts.json'), JSON.stringify(promptsPayload, null, 2), 'utf-8');

    // 3. 明确写入 AI 的原始输出归档: raw_ai_response.json
    const rawAiPayload = archive.aiCalls.map((call, idx) => ({
      callIndex: idx + 1,
      callType: call.callType,
      model: call.model,
      durationMs: call.durationMs,
      status: call.status,
      rawResponse: call.rawResponse,
      error: call.error || null,
    }));
    fs.writeFileSync(path.join(stageDir, 'raw_ai_response.json'), JSON.stringify(rawAiPayload, null, 2), 'utf-8');

    // 4. 明确写入本 Agent 最终输出物归档: output.json
    const outputPayload = {
      stage: archive.stage,
      agentName: archive.agentName,
      turnIndex: archive.turnIndex,
      endTime: archive.endTime,
      durationMs: archive.durationMs,
      status: archive.status,
      stopPointTitle: archive.stopPointTitle || null,
      stopPointDescription: archive.stopPointDescription || null,
      artifact: archive.finalArtifact || null,
      error: archive.error || null,
    };
    fs.writeFileSync(path.join(stageDir, 'output.json'), JSON.stringify(outputPayload, null, 2), 'utf-8');

    // 5. 写入多轮版本快照 turn_001.json
    const jsonFileName = `turn_${String(archive.turnIndex).padStart(3, '0')}.json`;
    const jsonPath = path.join(stageDir, jsonFileName);
    fs.writeFileSync(jsonPath, JSON.stringify(archive, null, 2), 'utf-8');

    // 6. 写入人类直读综合分析追踪文档: trace.md
    this.writeMarkdownTrace(stageDir, archive, inputPayload, outputPayload);

    // 7. 更新全局 .agent_debug/summary.md 与 session_audit.json
    this.updateGlobalAudit(debugDir, archive, stageFolder);
  }

  /**
   * 输出易读、结构完整的 Markdown 执行审计追踪文档
   */
  private writeMarkdownTrace(
    stageDir: string,
    archive: StageTurnArchive,
    inputPayload: any,
    outputPayload: any
  ): void {
    const mdPath = path.join(stageDir, 'trace.md');

    let content = `# 🕵️ [${getStageFolderPrefix(archive.stage)}] 输入与输出建档审计档案\n\n`;
    content += `- **项目 Session ID**: \`${archive.sessionId}\`\n`;
    content += `- **核心 Agent**: \`${archive.agentName}\`\n`;
    content += `- **当前轮次**: 第 ${archive.turnIndex} 轮\n`;
    content += `- **开始时间**: ${archive.startTime}\n`;
    content += `- **完成时间**: ${archive.endTime}\n`;
    content += `- **总耗时**: \`${archive.durationMs}ms\`\n`;
    content += `- **执行结果**: ${archive.status === 'success' ? '✅ 成功 (SUCCESS)' : '❌ 失败 (FAILED)'}\n`;
    if (archive.error) {
      content += `- **错误信息**: \n\`\`\`text\n${archive.error}\n\`\`\`\n`;
    }

    content += `\n---\n\n## 📥 一、 Agent 输入内容 (INPUT)\n`;
    if (archive.userFeedback) {
      content += `> **用户指令 / 修改指示 (userFeedback)**:\n> ${archive.userFeedback.replace(/\n/g, '\n> ')}\n\n`;
    }
    content += `### 完整输入参数清单 (参见 \`input.json\`):\n`;
    content += `\`\`\`json\n${JSON.stringify(inputPayload, null, 2)}\n\`\`\`\n`;

    content += `\n---\n\n## 🤖 二、 发送给 AI 的提示词 (PROMPTS) 与 原始回包\n`;

    if (archive.aiCalls.length === 0) {
      content += `*（本工序未记录直接 AI 网络请求，可能由规则引擎、FFmpeg 剪辑或下游服务合成完成）*\n`;
    } else {
      archive.aiCalls.forEach((call, idx) => {
        content += `\n### ⚡ AI 调用 #${idx + 1}: \`${call.callType}\` [${call.model}]\n`;
        content += `- **单次耗时**: \`${call.durationMs}ms\` | **状态**: \`${call.status}\`\n`;

        content += `\n#### 📤 提示词 (Prompt):\n`;
        if (typeof call.prompt === 'string') {
          content += `\`\`\`text\n${call.prompt.trim()}\n\`\`\`\n`;
        } else {
          if (call.prompt.systemPrompt) {
            content += `**[系统人设 (System Prompt)]**:\n\`\`\`text\n${call.prompt.systemPrompt.trim()}\n\`\`\`\n\n`;
          }
          content += `**[用户指令 (User Prompt)]**:\n\`\`\`text\n${call.prompt.userPrompt.trim()}\n\`\`\`\n`;
        }

        content += `\n#### 📥 AI 原始响应 (Raw Response 参见 \`raw_ai_response.json\`):\n`;
        if (call.rawResponse) {
          const respStr = typeof call.rawResponse === 'string' ? call.rawResponse : JSON.stringify(call.rawResponse, null, 2);
          content += `\`\`\`${typeof call.rawResponse === 'object' ? 'json' : 'text'}\n${respStr.slice(0, 4000)}${respStr.length > 4000 ? '\n... (已截断超长回包)' : ''}\n\`\`\`\n`;
        } else {
          content += `*(无原始回包记录)*\n`;
        }

        if (call.error) {
          content += `\n**❌ 调用异常**: \`${call.error}\`\n`;
        }
      });
    }

    content += `\n---\n\n## 📤 三、 Agent 输出内容 (OUTPUT ARTIFACT)\n`;
    content += `### 最终交付产出物结构体 (参见 \`output.json\`):\n`;
    content += `\`\`\`json\n${JSON.stringify(outputPayload, null, 2)}\n\`\`\`\n`;

    fs.writeFileSync(mdPath, content, 'utf-8');
  }

  /**
   * 更新全局审计汇总索引 .agent_debug/session_audit.json 与 summary.md
   */
  private updateGlobalAudit(debugDir: string, archive: StageTurnArchive, stageFolder: string): void {
    const summaryJsonPath = path.join(debugDir, 'session_audit.json');
    let summary: SessionAuditSummary = {
      sessionId: archive.sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalTurns: 0,
      stagesExecuted: [],
      records: [],
    };

    if (fs.existsSync(summaryJsonPath)) {
      try {
        summary = JSON.parse(fs.readFileSync(summaryJsonPath, 'utf-8'));
      } catch {
        // 忽略兜底解析异常
      }
    }

    summary.updatedAt = new Date().toISOString();
    summary.totalTurns += 1;
    if (!summary.stagesExecuted.includes(archive.stage)) {
      summary.stagesExecuted.push(archive.stage);
    }

    summary.records.push({
      archiveId: archive.archiveId,
      stage: archive.stage,
      agentName: archive.agentName,
      stageFolder,
      timestamp: archive.startTime,
      durationMs: archive.durationMs,
      status: archive.status,
      aiCallsCount: archive.aiCalls.length,
    });

    fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf-8');

    // 更新 summary.md 概要看板
    const summaryMdPath = path.join(debugDir, 'summary.md');
    let md = `# 📊 Agent 执行与全生命周期审计档案总览\n\n`;
    md += `- **项目 Session ID**: \`${archive.sessionId}\`\n`;
    md += `- **最近更新**: ${summary.updatedAt}\n`;
    md += `- **总执行轮次**: ${summary.totalTurns}\n`;
    md += `- **已覆盖工序**: ${summary.stagesExecuted.join(', ')}\n\n`;
    md += `| 阶段工序 | 目录 | 核心 Agent | 状态 | 耗时 | AI调用数 | 档案直达 |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

    for (const r of summary.records) {
      md += `| \`${r.stage}\` | \`.agent_debug/${r.stageFolder}\` | ${r.agentName} | ${r.status === 'success' ? '✅' : '❌'} | ${r.durationMs}ms | ${r.aiCallsCount} | [查看 Trace 文档](./${r.stageFolder}/trace.md) |\n`;
    }

    fs.writeFileSync(summaryMdPath, md, 'utf-8');
  }

  /**
   * 获取指定会话的全局审计汇总概览
   */
  getAuditSummary(projectDir: string): SessionAuditSummary | null {
    const debugDir = path.join(projectDir, '.agent_debug');
    const summaryPath = path.join(debugDir, 'session_audit.json');
    if (!fs.existsSync(summaryPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * 获取指定阶段的审计跟踪日志与归档产物
   */
  getStageTrace(
    projectDir: string,
    stage: WorkflowStage
  ): { markdown: string; input?: any; output?: any; prompts?: any; rawAiResponse?: any } | null {
    const debugDir = path.join(projectDir, '.agent_debug');
    const stageFolder = getStageFolderPrefix(stage);

    // 兼容带前缀目录与原始阶段名称检索
    let stageDir = path.join(debugDir, stageFolder);
    if (!fs.existsSync(stageDir)) {
      stageDir = path.join(debugDir, stage);
      if (!fs.existsSync(stageDir)) return null;
    }

    const mdPath = path.join(stageDir, 'trace.md');
    if (!fs.existsSync(mdPath)) return null;

    const markdown = fs.readFileSync(mdPath, 'utf-8');

    const readJsonSafe = (fileName: string) => {
      const p = path.join(stageDir, fileName);
      if (!fs.existsSync(p)) return null;
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        return null;
      }
    };

    return {
      markdown,
      input: readJsonSafe('input.json'),
      output: readJsonSafe('output.json'),
      prompts: readJsonSafe('prompts.json'),
      rawAiResponse: readJsonSafe('raw_ai_response.json'),
    };
  }
}

export const auditService = new AgentAuditService();
