import { Hono } from 'hono';
import { config } from '../../config/index.js';
import { listPromptCategories, loadPrompt, loadGenreModule } from '../../prompts/loader.js';

export const configRoutes = new Hono();

// 提示词分类与模板清单接口
configRoutes.get('/api/prompts/categories', (c) => {
  const categories = listPromptCategories();
  return c.json({ success: true, categories });
});

configRoutes.get('/api/prompts/content', (c) => {
  const category = c.req.query('category') || 'script';
  const name = c.req.query('name') || '';
  const lang = c.req.query('lang') || 'zh';

  if (!name) {
    return c.json({ success: false, error: 'name query parameter is required' }, 400);
  }

  try {
    const content = loadPrompt(category, name, lang);
    return c.json({ success: true, category, name, lang, content });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 404);
  }
});

// 前端里程碑工作流阶段列表
configRoutes.get('/api/stages', (c) => {
  return c.json({
    stages: [
      { id: 'narrative_design', name: '互动叙事', order: 1, description: '生成故事大纲、互动分支拓扑与人物设定' },
      { id: 'character_design', name: '角色设计', order: 2, description: '角色视觉定妆与多版本概念图' },
      { id: 'scene_script', name: '场次剧本', order: 3, description: '场次正文详写、对白提示与分支触发' },
      { id: 'storyboard', name: '分镜设计', order: 4, description: '镜头切分、景别运镜与交互点标定' },
      { id: 'keyframe_reference', name: '关键帧图', order: 5, description: '分镜关键帧画面与一致性参考' },
      { id: 'video_production', name: '分镜视频', order: 6, description: '分镜动态视频生成与声画对齐' },
      { id: 'fmv_packaging', name: '影游装配', order: 7, description: '决策等待呼吸循环、状态机与互动工程导出' },
    ],
  });
});

// 系统设置页与首页所需的模型及配置接口
configRoutes.get('/api/config', (c) => {
  return c.json({
    config: {
      mock_mode: config.mockMode,
      models: {
        llm: config.llm.model || 'qwen-plus',
        vlm: 'qwen-vl-max',
        image_t2i: config.image.model || 'wanx-v1',
        image_it2i: 'wanx-i2i-v1',
        video: config.video.model || 'wan2.1-i2v-plus',
        video_first_frame: config.video.model || 'wan2.1-i2v-plus',
        video_start_end: 'wan2.1-i2v-plus',
        video_reference: 'kling-v1-5',
      },
      generation: {
        style: 'realistic',
        video_ratio: '16:9',
        video_resolution: '720P',
        video_generation_mode: 'first_frame',
      },
      llm: {
        provider: config.llm.provider,
        model: config.llm.model,
        base_url: config.llm.baseUrl,
        api_key: config.llm.apiKey ? '******' : '',
      },
      image: {
        provider: config.image.provider,
        model: config.image.model,
        base_url: config.image.baseUrl,
        api_key: config.image.apiKey ? '******' : '',
      },
      video: {
        provider: config.video.provider,
        model: config.video.model,
        base_url: config.video.baseUrl,
        api_key: config.video.apiKey ? '******' : '',
      },
      ffmpeg: {
        path: config.paths.ffmpeg,
      },
    },
    path: 'server/.env',
  });
});

const handleSaveConfig = async (c: any) => {
  return c.json({
    status: 'ok',
    message: '配置已更新',
    path: 'server/.env',
  });
};
configRoutes.put('/api/config', handleSaveConfig);
configRoutes.post('/api/config', handleSaveConfig);

// 下拉选择框所需的各模态模型列表
configRoutes.get('/api/models', (c) => {
  const models = [
    // 大语言模型 (LLM)
    { id: 'qwen-turbo', label: 'Qwen Turbo (通义千问极速/极便宜)', provider: 'dashscope', model_type: 'llm', family: 'qwen' },
    { id: 'qwen-plus', label: 'Qwen Plus (通义千问标准)', provider: 'dashscope', model_type: 'llm', family: 'qwen' },
    { id: 'qwen-max', label: 'Qwen Max (通义千问旗舰)', provider: 'dashscope', model_type: 'llm', family: 'qwen' },
    { id: 'deepseek-chat', label: 'DeepSeek V3', provider: 'deepseek', model_type: 'llm', family: 'deepseek' },
    { id: 'gpt-4o', label: 'GPT-4o (OpenAI)', provider: 'openai', model_type: 'llm', family: 'openai' },
    // 视觉大语言模型 (VLM)
    { id: 'qwen-vl-max', label: 'Qwen VL Max', provider: 'dashscope', model_type: 'vlm', family: 'qwen' },
    // 文生图模型 (Image)
    { id: 'wanx-v1', label: 'Wanx 1.0 (通义万相标准)', provider: 'dashscope', media_type: 'image', model_type: 't2i' },
    { id: 'wanx2.1-t2i-plus', label: 'Wanx 2.1 Plus', provider: 'dashscope', media_type: 'image', model_type: 't2i' },
    { id: 'seedream-v1', label: 'Seedream 1.0 (火山引擎)', provider: 'ark', media_type: 'image', model_type: 't2i' },
    { id: 'dall-e-3', label: 'DALL-E 3', provider: 'openai', media_type: 'image', model_type: 't2i' },
    { id: 'wanx-i2i-v1', label: 'Wanx 图生图', provider: 'dashscope', media_type: 'image', model_type: 'i2i' },
    // 视频生成模型 (Video)
    { id: 'wan2.1-i2v-turbo', label: 'Wan 2.1 I2V Turbo (万相图生视频轻量/省成本)', provider: 'dashscope', media_type: 'video', model_type: 'video', ability: 'first_frame_i2v', ability_types: ['first_frame_i2v', 'start_end_frame_i2v'] },
    { id: 'wan2.1-t2v-turbo', label: 'Wan 2.1 T2V Turbo (万相文生视频轻量/省成本)', provider: 'dashscope', media_type: 'video', model_type: 'video', ability: 'first_frame_i2v', ability_types: ['first_frame_i2v'] },
    { id: 'wan2.1-i2v-plus', label: 'Wan 2.1 I2V Plus (万相图生视频高画质)', provider: 'dashscope', media_type: 'video', model_type: 'video', ability: 'first_frame_i2v', ability_types: ['first_frame_i2v', 'start_end_frame_i2v'] },
    { id: 'wan2.1-t2v-plus', label: 'Wan 2.1 T2V Plus (万相文生视频高画质)', provider: 'dashscope', media_type: 'video', model_type: 'video', ability: 'first_frame_i2v', ability_types: ['first_frame_i2v'] },
    { id: 'kling-v1-5', label: 'Kling 1.5 (快手可灵)', provider: 'kling', media_type: 'video', model_type: 'video', ability: 'first_frame_i2v', ability_types: ['first_frame_i2v', 'reference_to_video'] },
  ];
  return c.json({ success: true, models });
});
