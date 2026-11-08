const { getWorkingTurns } = await import('../src/project-store/conversation.js');
const turns = getWorkingTurns('proj_1793978592398_aslk', 'chat_1793978592400_6c7698', 10);
for (const t of turns) {
  console.log(`【${t.role}】 ${JSON.stringify(t.content.slice(0, 180))}`);
}
process.exit(0);
