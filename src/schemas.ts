import { z } from "zod";

/** ISO 8601 datetime string. */
export const isoDate = z.string().min(1);
const nullableIso = z.string().nullable().optional().default(null);

// ---------------------------------------------------------------- entities

export const projectInputSchema = z.object({
  clientUuid: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional().default(null),
  status: z.enum(["active", "archived"]).default("active"),
  dailyGoalMinutes: z.number().min(0).max(10080).default(0),
  weeklyGoalMinutes: z.number().min(0).max(10080).default(0),
  monthlyGoalMinutes: z.number().min(0).max(10080).default(0),
  goalDaysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .nullable()
    .optional()
    .default(null),
  color: z.number().int().default(0),
  notesMd: z.string().max(200000).nullable().optional().default(null),
  createdAt: isoDate.optional(),
  updatedAt: isoDate,
  deletedAt: nullableIso,
});

export const sessionInputSchema = z.object({
  clientUuid: z.string().min(1).max(64),
  projectId: z.number().int().positive().optional(),
  projectClientUuid: z.string().min(1).max(64).optional(),
  startedAt: isoDate,
  endedAt: nullableIso,
  durationSeconds: z.number().min(0).nullable().optional().default(null),
  status: z
    .enum(["running", "paused", "completed", "interrupted"])
    .default("running"),
  runningSince: nullableIso,
  targetSeconds: z.number().int().min(0).nullable().optional().default(null),
  createdAt: isoDate.optional(),
  updatedAt: isoDate,
  deletedAt: nullableIso,
});

export const contributionInputSchema = z.object({
  clientUuid: z.string().min(1).max(64),
  sessionId: z.number().int().positive().optional(),
  sessionClientUuid: z.string().min(1).max(64).optional(),
  projectId: z.number().int().positive().optional(),
  projectClientUuid: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(500),
  type: z.string().max(50).nullable().optional().default(null),
  createdAt: isoDate.optional(),
  updatedAt: isoDate,
  deletedAt: nullableIso,
});

export const noteInputSchema = z.object({
  clientUuid: z.string().min(1).max(64),
  projectId: z.number().int().positive().optional(),
  projectClientUuid: z.string().min(1).max(64).optional(),
  content: z.string().min(1).max(5000),
  createdAt: isoDate.optional(),
  updatedAt: isoDate,
  deletedAt: nullableIso,
});

export const settingsInputSchema = z.object({
  settings: z.record(z.string(), z.unknown()).default({}),
  updatedAt: isoDate,
});

// ---------------------------------------------------------------- envelopes

export const pushRequestSchema = z.object({
  projects: z.array(projectInputSchema).default([]),
  notes: z.array(noteInputSchema).default([]),
  sessions: z.array(sessionInputSchema).default([]),
  contributions: z.array(contributionInputSchema).default([]),
  settings: settingsInputSchema.optional(),
});

export const pullQuerySchema = z.object({
  since: isoDate.optional(),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export type ContributionInput = z.infer<typeof contributionInputSchema>;
export type NoteInput = z.infer<typeof noteInputSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type PushRequest = z.infer<typeof pushRequestSchema>;

// ---------------------------------------------------------------- output rows

export interface ProjectRow {
  id: number;
  clientUuid: string | null;
  name: string;
  description: string | null;
  status: string;
  dailyGoalMinutes: number;
  weeklyGoalMinutes: number;
  monthlyGoalMinutes: number;
  goalDaysOfWeek: number[] | null;
  color: number;
  notesMd: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SessionRow {
  id: number;
  clientUuid: string | null;
  projectId: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  status: string;
  runningSince: string | null;
  targetSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ContributionRow {
  id: number;
  clientUuid: string | null;
  projectId: number;
  sessionId: number | null;
  title: string;
  type: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteRow {
  id: number;
  clientUuid: string | null;
  projectId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SettingsRow {
  settings: Record<string, unknown>;
  updatedAt: string;
}

export interface PullResponse {
  projects: ProjectRow[];
  sessions: SessionRow[];
  contributions: ContributionRow[];
  notes: NoteRow[];
  settings: SettingsRow | null;
  serverTime: string;
}

export interface PushResponse {
  applied: {
    projects: ProjectRow[];
    sessions: SessionRow[];
    contributions: ContributionRow[];
    notes: NoteRow[];
    settings: SettingsRow | null;
  };
  /** Rows the server refused (server copy is newer); carries the winning rows. */
  rejected: {
    projects: ProjectRow[];
    sessions: SessionRow[];
    contributions: ContributionRow[];
    notes: NoteRow[];
    settings: SettingsRow | null;
  };
  serverTime: string;
}
