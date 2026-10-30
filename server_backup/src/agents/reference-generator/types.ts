export interface ReferenceGenerationShot {
  shotId: string;
  imageUrl: string;
  localPath: string;
  prompt: string;
  rewrite_result?: any;
}

export interface ReferenceGenerationArtifact {
  shots: ReferenceGenerationShot[];
}
