/** 条件仅为 JSON 键值相等合取，不执行模型生成的表达式。 */
export function resolveRoute(routes, state) {
  const matched = routes.filter(route => {
    if (!route.condition) return true;
    const rule = JSON.parse(route.condition);
    if (!rule || Array.isArray(rule) || typeof rule !== 'object') throw new Error('无效路由条件');
    return Object.entries(rule).every(([key, value]) => state[key] === value);
  });
  if (matched.length !== 1) throw new Error('剧情路由必须且只能命中一个目标');
  return matched[0].to;
}
