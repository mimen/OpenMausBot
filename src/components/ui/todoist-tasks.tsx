import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { api, type ComponentCall } from "@/state/store";
import { UiBadge, UiFrame } from "./frame";

const Task = z.object({
  id: z.string().min(1),
  content: z.string(),
  isCompleted: z.boolean(),
  url: z.string().nullable(),
  due: z.string().nullable(),
  unavailable: z.boolean().optional(),
});
const TodoistArguments = z.object({
  title: z.string().optional(),
  tasks: z.array(Task),
});

type TaskView = z.infer<typeof Task>;
type RowState = "idle" | "loading" | "completed" | "error";

function tasksFrom(call: ComponentCall): TaskView[] {
  const parsed = TodoistArguments.safeParse(call.arguments);
  return parsed.success ? parsed.data.tasks : [];
}

export function TodoistTasks({ call, threadId }: { call: ComponentCall; threadId: string }) {
  const parsed = TodoistArguments.safeParse(call.arguments);
  const tasks = tasksFrom(call);
  const title = parsed.success ? (parsed.data.title ?? "Todoist tasks") : "Todoist tasks";
  const [row, setRow] = useState<Record<string, { state: RowState; error?: string }>>({});
  const done = tasks.filter((task) => task.isCompleted || row[task.id]?.state === "completed").length;

  const complete = async (taskId: string) => {
    const current = row[taskId]?.state;
    if (current === "loading" || current === "completed") return;
    setRow((prev) => ({ ...prev, [taskId]: { state: "loading" } }));
    try {
      await api("/api/ui/todoist/complete", {
        method: "POST",
        body: JSON.stringify({
          threadId,
          callId: call.callId,
          taskId,
          actionToken: call.actionToken,
        }),
      });
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
          {done} of {tasks.length}
        </UiBadge>
      }
      caption="Completing a task takes an explicit click. Showing this list does not complete anything."
      title={title}
    >
      {tasks.length === 0 ? <p className="text-[13px] text-ink-secondary">No tasks to show.</p> : null}
      <ul className="space-y-2">
        {tasks.map((task) => {
          const state: RowState = task.isCompleted ? "completed" : (row[task.id]?.state ?? "idle");
          const error = row[task.id]?.error;
          return (
            <li className="flex items-start justify-between gap-3 rounded-xl bg-inset px-3 py-2.5" key={task.id}>
              <div className="min-w-0">
                <p className={state === "completed" ? "text-[14px] text-ink-secondary line-through" : "text-[14px] text-ink"}>
                  {task.content}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-secondary">{task.id}</p>
                {task.due ? <p className="text-[12px] text-ink-secondary">Due {task.due}</p> : null}
                {error ? <p className="mt-1 text-[12px] text-danger">{error}</p> : null}
              </div>
              <button
                type="button"
                disabled={state === "loading" || state === "completed" || task.unavailable}
                onClick={() => void complete(task.id)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-hairline/40 bg-raised px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {state === "completed" ? "Completed" : state === "loading" ? "Completing" : "Complete"}
              </button>
            </li>
          );
        })}
      </ul>
    </UiFrame>
  );
}
