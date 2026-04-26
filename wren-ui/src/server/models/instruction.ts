export interface InstructionInput {
  instruction: string;
  questions: string[];
  isDefault: boolean;
  relatedBusinessTerms?: string[];
  relatedExternalDependencies?: string[];
  runtimeUsage?: Record<string, any> | null;
}

export interface UpdateInstructionInput {
  id: number;
  instruction: string;
  questions: string[];
  isDefault: boolean;
  relatedBusinessTerms?: string[];
  relatedExternalDependencies?: string[];
  runtimeUsage?: Record<string, any> | null;
}
