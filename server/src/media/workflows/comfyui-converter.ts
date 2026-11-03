/**
 * media/workflows/comfyui-converter.ts
 * ComfyUI 工作流格式自适应解析与转换器 (UI Workflow -> API Prompt SSOT)
 */

export interface ComfyUINode {
  id: number;
  type: string;
  inputs?: Array<{
    name: string;
    link: number | null;
  }>;
  widgets_values?: any[];
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
 * 将 ComfyUI 画布导出格式 (UI Workflow) 自动转换为 /prompt API 可执行格式
 * 如果已经是 API Prompt 格式，则直接原样返回深拷贝
 */
export function ensureApiPromptFormat(rawWorkflow: any): ComfyUIApiPrompt {
  if (!rawWorkflow || typeof rawWorkflow !== 'object') {
    throw new Error('[ComfyUIConverter] 无效的工作流数据结构');
  }

  // 1. 如果已经是 API Prompt 格式 (键名为节点 ID 字符串，包含 class_type 与 inputs)
  const isApiFormat =
    !Array.isArray(rawWorkflow.nodes) &&
    Object.values(rawWorkflow).some(
      (v: any) => v && typeof v === 'object' && ('class_type' in v || 'inputs' in v)
    );

  if (isApiFormat) {
    return JSON.parse(JSON.stringify(rawWorkflow));
  }

  // 2. 如果是 UI Workflow 格式 (包含 nodes 与 links)
  const nodes: ComfyUINode[] = rawWorkflow.nodes || [];
  const links: Array<[number, number, number, number, number, string]> = rawWorkflow.links || [];

  // 构建 linkId -> [fromNodeIdStr, fromSlotIndex]
  const linksMap = new Map<number, [string, number]>();
  for (const link of links) {
    const [linkId, fromNode, fromSlot] = link;
    linksMap.set(linkId, [String(fromNode), fromSlot]);
  }

  const promptApi: ComfyUIApiPrompt = {};

  for (const node of nodes) {
    // 忽略纯 UI 注释与展示类节点
    if (node.type === 'MarkdownNote' || node.type === 'Note') {
      continue;
    }

    const nodeIdStr = String(node.id);
    const inputs: Record<string, any> = {};

    // 处理连线输入
    if (Array.isArray(node.inputs)) {
      for (const input of node.inputs) {
        if (input.link != null && linksMap.has(input.link)) {
          let paramName = input.name;
          // 归一化多模态图像槽位名称，如 images.image_1 -> image_1
          if (paramName.startsWith('images.')) {
            paramName = paramName.replace('images.', '');
          }
          inputs[paramName] = linksMap.get(input.link)!;
        }
      }
    }

    // 处理控件值 (widgets_values)
    const widgets = node.widgets_values || [];

    switch (node.type) {
      case 'UNETLoader':
        if (widgets.length >= 1) inputs.unet_name = widgets[0];
        if (widgets.length >= 2) inputs.weight_dtype = widgets[1];
        break;

      case 'CLIPLoader':
        if (widgets.length >= 1) inputs.clip_name = widgets[0];
        if (widgets.length >= 2) inputs.type = widgets[1];
        if (widgets.length >= 3) inputs.device = widgets[2];
        break;

      case 'VAELoader':
        if (widgets.length >= 1) inputs.vae_name = widgets[0];
        break;

      case 'LoadImage':
        if (widgets.length >= 1) inputs.image = widgets[0];
        if (widgets.length >= 2) inputs.upload = widgets[1];
        break;

      case 'TextEncodeQwenImage21':
        if (widgets.length >= 1) inputs.prompt = widgets[0];
        if (widgets.length >= 2) inputs.prompt_negative = widgets[1];
        if (widgets.length >= 3) inputs.max_length = widgets[2];
        break;

      case 'CLIPTextEncode':
        if (widgets.length >= 1) inputs.text = widgets[0];
        break;

      case 'EmptyLatentImage':
        if (widgets.length >= 1) inputs.width = widgets[0];
        if (widgets.length >= 2) inputs.height = widgets[1];
        if (widgets.length >= 3) inputs.batch_size = widgets[2];
        break;

      case 'KSampler':
        if (widgets.length >= 1) inputs.seed = widgets[0];
        if (widgets.length >= 3) inputs.steps = widgets[2];
        if (widgets.length >= 4) inputs.cfg = widgets[3];
        if (widgets.length >= 5) inputs.sampler_name = widgets[4];
        if (widgets.length >= 6) inputs.scheduler = widgets[5];
        if (widgets.length >= 7) inputs.denoise = widgets[6];
        break;

      case 'VAEDecode':
        // link 输入已在上面由 node.inputs 赋值 (samples, vae)
        break;

      case 'SaveImage':
        if (widgets.length >= 1) inputs.filename_prefix = widgets[0];
        break;

      default:
        // 未显式声明映射的节点保持干净，避免盲猜 value 造成参数污染
        break;
    }

    promptApi[nodeIdStr] = {
      class_type: node.type,
      inputs,
    };
  }

  return promptApi;
}
