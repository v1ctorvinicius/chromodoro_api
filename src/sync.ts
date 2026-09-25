import { SupabaseClient } from "@supabase/supabase-js";
import {
  ContributionInput,
  ContributionRow,
  NoteInput,
  NoteRow,
  ProjectInput,
  ProjectRow,
  PullResponse,
  PushRequest,
  PushResponse,
  SessionInput,
  SessionRow,
  SettingsInput,
  SettingsRow,
} from "./schemas";

const nowIso = () => new Date().toISOString();

type DBRow = Record<string, unknown>;

const iso = (v: unknown): string =>
  typeof v === "string" ? v : v instanceof Date ? v.toISOString() : nowIso();

const parseIso = (v: unknown): number => Date.parse(iso(v));

// ---------------------------------------------------------------- row mappers

const projectToRow = (r: DBRow): ProjectRow => ({
  id: Number(r.id),
  clientUuid: (r.client_uuid as string | null) ?? null,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  status: (r.status as string) ?? "active",
  dailyGoalMinutes: Number(r.daily_goal_minutes ?? 0),
  weeklyGoalMinutes: Number(r.weekly_goal_minutes ?? 0),
  monthlyGoalMinutes: Number(r.monthly_goal_minutes ?? 0),
  goalDaysOfWeek: (r.goal_days_of_week as number[] | null) ?? null,
  color: Number(r.color ?? 0),
  notesMd: (r.notes_md as string | null) ?? null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  deletedAt: (r.deleted_at as string | null) ?? null,
});

const sessionToRow = (r: DBRow): SessionRow => ({
  id: Number(r.id),
  clientUuid: (r.client_uuid as string | null) ?? null,
  projectId: Number(r.project_id),
  startedAt: iso(r.started_at),
  endedAt: (r.ended_at as string | null) ?? null,
  durationSeconds:
    r.duration_seconds === null || r.duration_seconds === undefined
      ? null
      : Number(r.duration_seconds),
  status: (r.status as string) ?? "running",
  runningSince: (r.running_since as string | null) ?? null,
  targetSeconds:
    r.target_seconds === null || r.target_seconds === undefined
      ? null
      : Number(r.target_seconds),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  deletedAt: (r.deleted_at as string | null) ?? null,
});

const contributionToRow = (r: DBRow): ContributionRow => ({
  id: Number(r.id),
  clientUuid: (r.client_uuid as string | null) ?? null,
  projectId: Number(r.project_id),
  sessionId:
    r.session_id === null || r.session_id === undefined
      ? null
      : Number(r.session_id),
  title: r.title as string,
  type: (r.type as string | null) ?? null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  deletedAt: (r.deleted_at as string | null) ?? null,
});

const noteToRow = (r: DBRow): NoteRow => ({
  id: Number(r.id),
  clientUuid: (r.client_uuid as string | null) ?? null,
  projectId: Number(r.project_id),
  content: r.content as string,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  deletedAt: (r.deleted_at as string | null) ?? null,
});

const settingsToRow = (r: DBRow | null): SettingsRow | null =>
  r
    ? {
        settings: (r.settings as Record<string, unknown>) ?? {},
        updatedAt: iso(r.updated_at),
      }
    : null;

// ---------------------------------------------------------------- FK resolver

class FkResolver {
  private projectIds = new Map<string, number>();
  private sessionIds = new Map<string, number>();

  constructor(private supabase: SupabaseClient, private userId: string) {}

  async prime(projectUuids: string[], sessionUuids: string[]): Promise<void> {
    if (projectUuids.length) {
      const { data } = await this.supabase
        .from("projects")
        .select("id, client_uuid")
        .eq("user_id", this.userId)
        .in("client_uuid", projectUuids);
      for (const r of data ?? []) this.projectIds.set(r.client_uuid as string, Number(r.id));
    }
    if (sessionUuids.length) {
      const { data } = await this.supabase
        .from("sessions")
        .select("id, client_uuid")
        .eq("user_id", this.userId)
        .in("client_uuid", sessionUuids);
      for (const r of data ?? []) this.sessionIds.set(r.client_uuid as string, Number(r.id));
    }
  }

  projectId(uuid: string | undefined, id: number | undefined): number | null {
    if (id !== undefined) return id;
    if (uuid !== undefined) return this.projectIds.get(uuid) ?? null;
    return null;
  }

  sessionId(uuid: string | undefined, id: number | undefined): number | null {
    if (id !== undefined) return id;
    if (uuid !== undefined) return this.sessionIds.get(uuid) ?? null;
    return null;
  }

  addProject(uuid: string, id: number): void {
    this.projectIds.set(uuid, id);
  }

  addSession(uuid: string, id: number): void {
    this.sessionIds.set(uuid, id);
  }
}

// ---------------------------------------------------------------- upsert core

async function findExisting<T extends DBRow>(
  supabase: SupabaseClient,
  table: string,
  userId: string,
  clientUuid: string
): Promise<T | null> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .eq("client_uuid", clientUuid)
    .maybeSingle();
  if (error) throw new Error(`${table} find: ${error.message}`);
  return (data as T | null) ?? null;
}

/**
 * Generic LWW upsert for entities keyed by (user_id, client_uuid).
 * Returns { row, serverNewer } where row is the winning server row after the
 * operation (either `existing` kept as-is, or the freshly applied payload).
 */
async function lwwUpsert<T extends DBRow, P extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  userId: string,
  clientUuid: string,
  incomingUpdatedAt: string,
  payload: P
): Promise<{ row: T; serverNewer: boolean; applied: boolean }> {
  const existing = await findExisting<T>(supabase, table, userId, clientUuid);
  if (existing && parseIso(existing.updated_at) > parseIso(incomingUpdatedAt)) {
    return { row: existing, serverNewer: true, applied: false };
  }

  const base = {
    user_id: userId,
    created_at: existing?.created_at ?? nowIso(),
    updated_at: incomingUpdatedAt,
  };
  const { data, error } = existing
    ? await supabase
        .from(table)
        .update({ ...payload, ...base })
        .eq("user_id", userId)
        .eq("client_uuid", clientUuid)
        .select("*")
        .maybeSingle()
    : await supabase.from(table).insert({ ...payload, ...base }).select("*").maybeSingle();
  if (error) throw new Error(`${table} upsert: ${error.message}`);
  return { row: data as T, serverNewer: false, applied: true };
}

// ---------------------------------------------------------------- pull

async function pullTable(
  supabase: SupabaseClient,
  table: string,
  userId: string,
  since: string | undefined
): Promise<DBRow[]> {
  let q = supabase.from(table).select("*").eq("user_id", userId);
  if (since) q = q.gte("updated_at", since).or(`deleted_at.is.null,deleted_at.gte.${since}`);
  const { data, error } = await q;
  if (error) throw new Error(`${table} pull: ${error.message}`);
  return (data ?? []) as DBRow[];
}

export async function handlePull(
  supabase: SupabaseClient,
  userId: string,
  since: string | undefined
): Promise<PullResponse> {
  const settingsQuery = since
    ? supabase.from("user_settings").select("*").eq("user_id", userId).gte("updated_at", since).maybeSingle()
    : supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  const { data: settingsData, error: settingsError } = await settingsQuery;
  if (settingsError) throw new Error(`user_settings pull: ${settingsError.message}`);

  const projects = (await pullTable(supabase, "projects", userId, since)).map(projectToRow);
  const sessions = (await pullTable(supabase, "sessions", userId, since)).map(sessionToRow);
  const contributions = (await pullTable(supabase, "contributions", userId, since)).map(contributionToRow);
  const notes = (await pullTable(supabase, "notes", userId, since)).map(noteToRow);

  return {
    projects,
    sessions,
    contributions,
    notes,
    settings: settingsToRow(settingsData),
    serverTime: nowIso(),
  };
}

// ---------------------------------------------------------------- push

export async function handlePush(
  supabase: SupabaseClient,
  userId: string,
  req: PushRequest
): Promise<PushResponse> {
  const resolver = new FkResolver(supabase, userId);

  const projectUuids = [
    ...req.projects.map((p) => p.clientUuid),
    ...req.sessions.map((s) => s.projectClientUuid ?? ""),
    ...req.notes.map((n) => n.projectClientUuid ?? ""),
    ...req.contributions.map((c) => c.projectClientUuid ?? ""),
  ].filter(Boolean);
  const sessionUuids = req.contributions
    .map((c) => c.sessionClientUuid ?? "")
    .filter(Boolean);
  await resolver.prime(projectUuids, sessionUuids);

  const rejectedProjects: ProjectRow[] = [];
  const appliedProjects: ProjectRow[] = [];
  const rejectedNotes: NoteRow[] = [];
  const appliedNotes: NoteRow[] = [];
  const rejectedSessions: SessionRow[] = [];
  const appliedSessions: SessionRow[] = [];
  const rejectedContributions: ContributionRow[] = [];
  const appliedContributions: ContributionRow[] = [];

  // 1) projects -------------------------------------------------------------
  for (const item of req.projects) {
    const { row, serverNewer } = await lwwUpsert(
      supabase,
      "projects",
      userId,
      item.clientUuid,
      item.updatedAt,
      {
        client_uuid: item.clientUuid,
        name: item.name,
        description: item.description,
        status: item.status,
        daily_goal_minutes: item.dailyGoalMinutes,
        weekly_goal_minutes: item.weeklyGoalMinutes,
        monthly_goal_minutes: item.monthlyGoalMinutes,
        goal_days_of_week: item.goalDaysOfWeek,
        color: item.color,
        notes_md: item.notesMd,
        deleted_at: item.deletedAt,
      }
    );
    const out = projectToRow(row);
    resolver.addProject(item.clientUuid, out.id);
    (serverNewer ? rejectedProjects : appliedProjects).push(out);
  }

  // 2) notes ---------------------------------------------------------------
  for (const item of req.notes) {
    const projectId = resolver.projectId(item.projectClientUuid, item.projectId);
    if (projectId === null) continue; // parent not resolvable — client re-pulls
    const { row, serverNewer } = await lwwUpsert(
      supabase,
      "notes",
      userId,
      item.clientUuid,
      item.updatedAt,
      {
        client_uuid: item.clientUuid,
        project_id: projectId,
        content: item.content,
        deleted_at: item.deletedAt,
      }
    );
    (serverNewer ? rejectedNotes : appliedNotes).push(noteToRow(row));
  }

  // 3) sessions ------------------------------------------------------------
  for (const item of req.sessions) {
    const projectId = resolver.projectId(item.projectClientUuid, item.projectId);
    if (projectId === null) continue;
    const { row, serverNewer } = await lwwUpsert(
      supabase,
      "sessions",
      userId,
      item.clientUuid,
      item.updatedAt,
      {
        client_uuid: item.clientUuid,
        project_id: projectId,
        started_at: item.startedAt,
        ended_at: item.endedAt,
        duration_seconds: item.durationSeconds,
        status: item.status,
        running_since: item.runningSince,
        target_seconds: item.targetSeconds,
        deleted_at: item.deletedAt,
      }
    );
    const out = sessionToRow(row);
    resolver.addSession(item.clientUuid, out.id);
    (serverNewer ? rejectedSessions : appliedSessions).push(out);
  }

  // 4) contributions --------------------------------------------------------
  for (const item of req.contributions) {
    const sessionId = resolver.sessionId(item.sessionClientUuid, item.sessionId);
    const projectId = resolver.projectId(item.projectClientUuid, item.projectId);
    let finalProjectId = projectId;
    let finalSessionId = sessionId;
    if (finalProjectId === null) {
      // derive project from a *resolved* session
      const { data } = await supabase
        .from("sessions")
        .select("project_id")
        .eq("user_id", userId)
        .eq("id", finalSessionId ?? 0)
        .maybeSingle();
      if (data) finalProjectId = Number(data.project_id);
    }
    if (finalProjectId === null) continue;

    const { row, serverNewer } = await lwwUpsert(
      supabase,
      "contributions",
      userId,
      item.clientUuid,
      item.updatedAt,
      {
        client_uuid: item.clientUuid,
        project_id: finalProjectId,
        session_id: finalSessionId,
        title: item.title,
        type: item.type,
        deleted_at: item.deletedAt,
      }
    );
    (serverNewer ? rejectedContributions : appliedContributions).push(contributionToRow(row));
  }

  // 5) settings -------------------------------------------------------------
  let appliedSettings: SettingsRow | null = null;
  let rejectedSettings: SettingsRow | null = null;
  if (req.settings) {
    const item = req.settings;
    const { data, error } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`user_settings find: ${error.message}`);
    const existing = data as DBRow | null;
    if (existing && parseIso(existing.updated_at) > parseIso(item.updatedAt)) {
      rejectedSettings = settingsToRow(existing);
    } else {
      const payload = {
        user_id: userId,
        settings: item.settings,
        created_at: existing?.created_at ?? nowIso(),
        updated_at: item.updatedAt,
      };
      const { data: up, error: upErr } = existing
        ? await supabase.from("user_settings").update(payload).eq("user_id", userId).select("*").maybeSingle()
        : await supabase.from("user_settings").insert(payload).select("*").maybeSingle();
      if (upErr) throw new Error(`user_settings upsert: ${upErr.message}`);
      appliedSettings = settingsToRow(up);
    }
  }

  return {
    applied: {
      projects: appliedProjects,
      sessions: appliedSessions,
      contributions: appliedContributions,
      notes: appliedNotes,
      settings: appliedSettings,
    },
    rejected: {
      projects: rejectedProjects,
      sessions: rejectedSessions,
      contributions: rejectedContributions,
      notes: rejectedNotes,
      settings: rejectedSettings,
    },
    serverTime: nowIso(),
  };
}

export type { ProjectInput, SessionInput, ContributionInput, NoteInput, SettingsInput };