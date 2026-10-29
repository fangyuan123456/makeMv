export function parseScriptText(text: string) {
  const lines = text.split('\n');
  let title = '未命名剧作';
  let theme = '影视短片';
  let logline = '';
  const characterNamesSet = new Set<string>();
  const locationsSet = new Set<string>();
  const episodes: any[] = [];

  let currentEp: any = null;
  let currentScene: any = null;
  let itemIdCounter = 1;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Title: # 《xxx》 or 《xxx》 or 标题：xxx
    const titleMatch = line.match(/^#?\s*《([^》]+)》/) || line.match(/^(?:标题|片名)[：:]\s*(.+)$/);
    if (titleMatch && title === '未命名剧作') {
      title = titleMatch[1].trim();
      continue;
    }

    // Theme: 类型：xxx or 主题：xxx
    const themeMatch = line.match(/^(?:类型|主题)[：:]\s*(.+)$/);
    if (themeMatch) {
      theme = themeMatch[1].trim();
      continue;
    }

    // Logline: 梗概：xxx or 总梗概：xxx
    const logMatch = line.match(/^(?:梗概|总梗概|故事梗概|logline)[：:]\s*(.+)$/i);
    if (logMatch) {
      logline = logMatch[1].trim();
      continue;
    }

    // Episode / Act header: ## 第x集：xxx or 【第x幕】
    const epMatch = line.match(/^(?:##\s*)?(?:第\s*([0-9一二三四五六七八九十]+)\s*[集幕]|【第\s*([0-9一二三四五六七八九十]+)\s*[集幕]】)[：:\s]*(.*)$/);
    if (epMatch) {
      const epNum = episodes.length + 1;
      const epTitle = epMatch[3]?.trim().replace(/^[:：\s-]+/, '') || (`第${epNum}集`);
      currentEp = {
        episodeNumber: epNum,
        title: epTitle,
        logline: '',
        scenes: []
      };
      episodes.push(currentEp);
      currentScene = null;
      continue;
    }

    // Scene header: **第x集-第y场 日/夜 内/外 地点** or 场景 x：xxx or ### 场景 x
    const sceneMatch = line.match(/^(?:[#*]{0,3})\s*(?:第\s*[0-9一二三四五六七八九十]+[-_场集]*\s*第?\s*([0-9一二三四五六七八九十]+)\s*场|场景\s*([0-9一二三四五六七八九十]+)|【场景\s*([0-9一二三四五六七八九十]+)[：:]?([^】]*)】)[：:\s]*(.*)$/);
    if (sceneMatch || line.startsWith('场景') || (line.includes('场') && (line.includes('内') || line.includes('外') || line.includes('日') || line.includes('夜')))) {
      if (!currentEp) {
        currentEp = { episodeNumber: 1, title: '第1集', logline: '', scenes: [] };
        episodes.push(currentEp);
      }
      const scNum = currentEp.scenes.length + 1;
      const rest = line.replace(/[*#【】]/g, '').trim();
      let time = '日';
      if (rest.includes('夜')) time = '夜';
      else if (rest.includes('黄昏')) time = '黄昏';
      else if (rest.includes('黎明')) time = '黎明';

      let space = rest.includes('外') ? '外' : '内';
      let loc = rest.replace(/^(?:第[^\s]+场|场景\s*[0-9]+[：:]?)/, '').replace(/(?:日|夜|黄昏|黎明|内景?|外景?)/g, '').replace(/[-_—]/g, ' ').trim() || (`场景 ${scNum}`);
      if (loc) locationsSet.add(loc);

      currentScene = {
        sceneId: `E${String(currentEp.episodeNumber).padStart(2, '0')}_S${String(scNum).padStart(2, '0')}`,
        title: loc,
        time,
        space,
        location: loc,
        characters: [],
        items: []
      };
      currentEp.scenes.push(currentScene);
      continue;
    }

    // Characters in scene: 人物：xxx、yyy or 出场：xxx
    const charLineMatch = line.match(/^(?:人物|出场|登场角色)[：:]\s*(.+)$/);
    if (charLineMatch && currentScene) {
      const names = charLineMatch[1].split(/[,，、\s]+/).filter(Boolean);
      names.forEach(n => {
        characterNamesSet.add(n);
        if (!currentScene.characters.includes(n)) currentScene.characters.push(n);
      });
      continue;
    }

    // Ensure we have currentEp and currentScene
    if (!currentEp) {
      currentEp = { episodeNumber: 1, title: '第1集', logline: '', scenes: [] };
      episodes.push(currentEp);
    }
    if (!currentScene) {
      currentScene = {
        sceneId: `E${String(currentEp.episodeNumber).padStart(2, '0')}_S01`,
        title: '场景 1',
        time: '日',
        space: '内',
        location: '主场景',
        characters: [],
        items: []
      };
      currentEp.scenes.push(currentScene);
    }

    // Action: [动作] xxx or <action> xxx or 🎬 xxx
    if (line.startsWith('[动作]') || line.startsWith('【动作】') || line.startsWith('<action>') || line.startsWith('🎬') || line.startsWith('（动作）')) {
      const desc = line.replace(/^(?:\[动作\]|【动作】|<action>|🎬|（动作）)\s*/, '').trim();
      currentScene.items.push({
        id: `i${itemIdCounter++}`,
        type: 'action',
        action: { description: desc }
      });
      continue;
    }

    // Dialogue: Speaker（Emotion）：Text or Speaker: Text
    const diaMatch = line.match(/^([^：:()（）]{1,15})(?:[（(]([^）)]+)[）)])?[：:]\s*(.+)$/);
    if (diaMatch) {
      const speaker = diaMatch[1].trim();
      const emotion = diaMatch[2]?.trim();
      const text = diaMatch[3].trim().replace(/^["“'‘]|["”'’]$/g, '');
      if (speaker !== '类型' && speaker !== '主题' && speaker !== '梗概' && speaker !== '人物' && speaker !== '场景') {
        if (speaker !== '旁白') characterNamesSet.add(speaker);
        if (!currentScene.characters.includes(speaker) && speaker !== '旁白') currentScene.characters.push(speaker);
        currentScene.items.push({
          id: `i${itemIdCounter++}`,
          type: 'dialogue',
          dialogue: { character: speaker, emotionPrompt: emotion, text }
        });
        continue;
      }
    }

    // Otherwise fallback action description
    currentScene.items.push({
      id: `i${itemIdCounter++}`,
      type: 'action',
      action: { description: line }
    });
  }

  return {
    title,
    theme,
    logline,
    characterNames: Array.from(characterNamesSet),
    locations: Array.from(locationsSet),
    episodes,
    scriptText: text,
    rawText: text
  };
}
