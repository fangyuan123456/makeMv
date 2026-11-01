/**
 * agents/doctor/steps/error-diagnosis/schema.ts
 */

import { z } from 'zod';
import { DoctorDiagnosisResultSchema } from '../../types.js';

export const ErrorDiagnosisOutputSchema = DoctorDiagnosisResultSchema;
export type ErrorDiagnosisOutput = z.infer<typeof ErrorDiagnosisOutputSchema>;
