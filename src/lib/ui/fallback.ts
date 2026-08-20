export type ComponentFallback = { title: string; body: string };

export function componentFallback(name: string, reason: string): ComponentFallback {
  return { title: name || "Component", body: reason };
}
