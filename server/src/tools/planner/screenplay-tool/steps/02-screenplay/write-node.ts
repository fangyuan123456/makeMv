import { generateText } from 'ai';
import { LLMProvider } from '../../../../../llm/index.js';
import { buildScreenplaySystemPrompt } from './prompt.js';

/** 结构已经由大纲固定；扩写只生成正文，字段包装由代码负责。 */
export async function writeSceneText({prompt,abortSignal}:{prompt:string;abortSignal?:AbortSignal}):Promise<string> {
  for(let attempt=0;attempt<2;attempt++){
    const result=await generateText({model:LLMProvider.getModel(),system:buildScreenplaySystemPrompt(),prompt,abortSignal});
    if(result.text.trim())return result.text;
  }
  throw new Error('场景扩写连续两次返回空正文');
}
