// Sidebar previews show one line of a reply; markdown syntax there reads as
// noise ("**fake**", code fences), so it is reduced to the words it wraps.

export function previewText(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
