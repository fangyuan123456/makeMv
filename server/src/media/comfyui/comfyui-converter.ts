/**
 * media/comfyui/comfyui-converter.ts
 * ComfyUI 工作流模板格式守卫 + 离线转换工具
 *
 * 运行时只接受 /prompt API 格式（class_type + 具名 inputs）。
 * UI 画布导出格式（nodes/links + widgets_values 位置数组）不是 API 契约，
 * 在运行时按节点类型/位置猜字段名会静默丢字段，因此统一在离线阶段转换。
 */

export interface ComfyUINode {
  id: number;
  type: string;
  inputs?: Array<{
    name: string;
    link: number | null;
    widget?: { name: string };
  }>;
  widgets_values_named?: Record<string, unknown>;
}

export interface ComfyUIWorkflow {
  nodes?: ComfyUINode[];
  links?: Array<[number, number, number, number, number, string]>;
}

export type ComfyUIApiPrompt = Record<
  string,
  {
    class_type: string;
    inputs: Record<string, any>;
  }
>;

/**
 * 运行时模板加载：只放行 /prompt API 格式，原样深拷贝返回。
 * 遇到 UI 画布格式直接抛错，不做任何格式猜测。
 */
export function ensureApiPromptFormat(rawWorkflow: any): ComfyUIApiPrompt {
  if (!rawWorkflow || typeof rawWorkflow !== 'object') {
    throw new Error('[ComfyUIConverter] 无效的工作流数据结构');
  }

  const isApiFormat =
    !Array.isArray(rawWorkflow.nodes) &&
    Object.values(rawWorkflow).some(
      (v: any) => v && typeof v === 'object' && ('class_type' in v || 'inputs' in v)
    );

  if (isApiFormat) {
    return JSON.parse(JSON.stringify(rawWorkflow));
  }

  throw new Error(
    '[ComfyUIConverter] 工作流模板不是 /prompt API 格式（检测到 nodes/links 画布结构）。' +
      '请在 ComfyUI 中用「Save (API Format)」重新导出，或离线调用 convertUiWorkflowToApiPrompt 转换；运行时不做格式猜测。'
  );
}

/**
 * 离线工具：把 ComfyUI 新版 UI 画布导出（inputs[].widget + widgets_values_named）
 * 转成 /prompt API 格式。仅供一次性迁移 / 导出脚本使用，运行时禁止调用。
 * 旧版画布（只有 widgets_values 位置数组）请直接从 ComfyUI 导出 API 格式，勿按位置猜字段。
 */
export function convertUiWorkflowToApiPrompt(rawWorkflow: ComfyUIWorkflow): ComfyUIApiPrompt {
  const nodes: ComfyUINode[] = rawWorkflow.nodes || [];
  const links: Array<[number, number, number, number, number, string]> = rawWorkflow.links || [];

  const linksMap = new Map<number, [string, number]>();
  for (const link of links) {
    const [linkId, fromNode, fromSlot] = link;
    linksMap.set(linkId, [String(fromNode), fromSlot]);
  }

  const promptApi: ComfyUIApiPrompt = {};

  for (const node of nodes) {
    if (node.type === 'MarkdownNote' || node.type === 'Note') {
      continue;
    }

    const inputs: Record<string, any> = {};

    if (Array.isArray(node.inputs)) {
      for (const input of node.inputs) {
        if (input.link != null) {
          const source = linksMap.get(input.link);
          if (!source) {
            throw new Error(
              `[ComfyUIConverter] 节点 ${node.id} 的输入 ${input.name} 引用了不存在的连线 ${input.link}`
            );
          }
          inputs[input.name] = source;
        } else if (input.widget) {
          const widgetName = input.widget.name;
          const value = node.widgets_values_named?.[widgetName];
          if (value === undefined) {
            throw new Error(`[ComfyUIConverter] 节点 ${node.id} 的控件 ${widgetName} 缺少具名值`);
          }
          inputs[input.name] = value;
        }
      }
    }

    promptApi[String(node.id)] = {
      class_type: node.type,
      inputs,
    };
  }

  return promptApi;
}
