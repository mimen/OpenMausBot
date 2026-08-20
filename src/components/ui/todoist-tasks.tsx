import { CalendarDays, Check, Hash, Loader2, MessageSquare } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import type { ComponentCall } from "@/state/store";
import { UI_LIMITS } from "../../../server/ui/contract";
import { UiBadge, UiFrame } from "./frame";

const Task = z.object({
  id: z.string().min(1).max(UI_LIMITS.providerIdentity),
  content: z.string().max(UI_LIMITS.content),
  description: z.string().max(UI_LIMITS.value).nullable().optional(),
  isCompleted: z.boolean(),
  url: z.string().max(UI_LIMITS.value).nullable(),
  due: z.string().max(UI_LIMITS.label).nullable(),
  recurring: z.boolean().optional(),
  projectId: z.string().max(UI_LIMITS.providerIdentity).nullable().optional(),
  projectName: z.string().max(UI_LIMITS.label).nullable().optional(),
  labels: z.array(z.string().max(UI_LIMITS.label)).max(20).optional(),
  commentCount: z.number().int().nonnegative().max(10_000).optional(),
  unavailable: z.boolean().optional(),
}).strict();
const TodoistArguments = z.object({
  title: z.string().max(UI_LIMITS.title).optional(),
  tasks: z.array(Task).max(UI_LIMITS.todoistRows),
}).strict();

type TaskView = z.infer<typeof Task>;
type RowState = "idle" | "loading" | "completed" | "error";

export function todoistActionLabel(state: RowState, content: string): string {
  const action = state === "completed" ? "Completed" : state === "loading" ? "Completing" : "Complete";
  return `${action} ${content}`;
}

export function formatTodoistDue(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function boundedTodoistTasks(call: ComponentCall): TaskView[] {
  const parsed = TodoistArguments.safeParse(call.arguments);
  return parsed.success ? parsed.data.tasks : [];
}

export function TodoistTasks({ call, threadId }: { call: ComponentCall; threadId: string }) {
  const parsed = TodoistArguments.safeParse(call.arguments);
  const tasks = boundedTodoistTasks(call);
  const title = parsed.success ? (parsed.data.title ?? "Todoist tasks") : "Todoist tasks";
  const [row, setRow] = useState<Record<string, { state: RowState; error?: string }>>({});
  const done = tasks.filter((task) => task.isCompleted || row[task.id]?.state === "completed").length;
  const desktopCompletion = window.ogb?.todoist?.complete;

  const complete = async (taskId: string) => {
    const current = row[taskId]?.state;
    if (!desktopCompletion || current === "loading" || current === "completed") return;
    setRow((prev) => ({ ...prev, [taskId]: { state: "loading" } }));
    try {
      await desktopCompletion({ threadId, callId: call.callId, taskId });
      setRow((prev) => ({ ...prev, [taskId]: { state: "completed" } }));
    } catch (error) {
      setRow((prev) => ({
        ...prev,
        [taskId]: { state: "error", error: error instanceof Error ? error.message : String(error) },
      }));
    }
  };

  return (
    <UiFrame
      action={
        <UiBadge tone={done === tasks.length && tasks.length > 0 ? "positive" : "neutral"}>
          {done} / {tasks.length}
        </UiBadge>
      }
      caption={desktopCompletion ? "Click the circle to complete in Todoist." : "Read-only preview. Complete tasks in the desktop app."}
      title={title}
    >
      <div>
        {tasks.length === 0 ? <p className="text-[13px] text-ink-secondary" role="status">No tasks to show.</p> : null}
        <ul aria-busy={tasks.some((task) => row[task.id]?.state === "loading")}>
          {tasks.map((task) => {
            const state: RowState = task.isCompleted ? "completed" : (row[task.id]?.state ?? "idle");
            const error = row[task.id]?.error;
            const description = task.description?.trim();
            const labels = task.labels ?? [];
            const commentCount = task.commentCount ?? 0;
            const completed = state === "completed";
            const loading = state === "loading";
            const disabled = !desktopCompletion || loading || completed || task.unavailable;
            return (
              <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 border-b border-hairline/35 py-3 last:border-b-0" key={task.id}>
                <button
                  type="button"
                  aria-busy={loading}
                  aria-label={todoistActionLabel(state, task.content)}
                  aria-disabled={disabled}
                  onClick={() => {
                    if (!disabled) void complete(task.id);
                  }}
                  className={`group/check relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors after:absolute after:-inset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                    completed
                      ? "border-[#dc4c3e] bg-[#dc4c3e] text-white"
                      : loading
                        ? "border-[#dc4c3e] text-[#dc4c3e]"
                        : task.unavailable
                          ? "border-ink-secondary/35 text-transparent"
                          : "border-[#dc4c3e] text-white hover:bg-[#dc4c3e] disabled:opacity-45"
                  } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                >
                  {loading ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Check size={12} strokeWidth={3} className={completed ? "opacity-100" : "opacity-0 transition-opacity group-hover/check:opacity-100"} aria-hidden="true" />
                  )}
                </button>

                <div className="min-w-0">
                  <p className={completed ? "text-[14px] leading-5 text-ink-secondary line-through" : "text-[14px] leading-5 text-ink"}>
                    <span className="sr-only">{completed ? "Completed: " : "Not completed: "}</span>
                    {task.content}
                  </p>
                  {description ? <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-ink-secondary">{description}</p> : null}

                  <div className="mt-1.5 flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-secondary">
                    {task.due ? (
                      <span className="inline-flex items-center gap-1 text-[#dc4c3e]">
                        <CalendarDays size={13} strokeWidth={1.8} aria-hidden="true" />
                        {formatTodoistDue(task.due)}
                      </span>
                    ) : null}
                    {commentCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare size={13} strokeWidth={1.8} aria-hidden="true" />
                        {commentCount}
                      </span>
                    ) : null}
                    {labels.map((label) => <span key={label}>#{label}</span>)}
                    {task.projectName ? (
                      <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap">
                        {task.projectName}
                        <Hash size={13} strokeWidth={2} className="text-ink-secondary" aria-hidden="true" />
                      </span>
                    ) : null}
                    {loading ? <span>Completing…</span> : null}
                    {completed ? <span>Completed</span> : null}
                  </div>

                  {error ? <p className="mt-1 text-[12px] text-danger" role="alert">{error}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </UiFrame>
  );
}
