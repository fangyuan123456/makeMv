/**
 * project-store/types.ts
 * 全局项目单一事实来源强类型契约 (Project Store Types SSOT)
 */

export interface ProjectMetadata {
  projectId: string;
  title: string;
  genre?: string;
  createdAt: string;
  updatedAt: string;
  currentStage: 'gdd_planning' | 'text_game_authoring' | 'film_compiling' | 'completed';
}

export interface ProjectChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'done' | 'error';
  proposal?: Record<string, any>;
  proposalResolved?: boolean;
  taskRunId?: string;
  taskStage?: 'plan_gdd' | 'build_text_game';
  nextProposalResolved?: boolean;
}

export interface ProjectData {
  meta: ProjectMetadata;
  artifacts: {
    gdd?: any;               // 策划案阶段产物
    text_game?: any;         // 文游阶段产物
    film_spec?: any;         // 影游切片阶段产物
    [key: string]: any;
  };
  chat?: ProjectChatMessage[];
}
