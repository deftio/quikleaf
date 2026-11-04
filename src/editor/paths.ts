/**
 * Small path helpers for the frontend: where a document lives, how an image
 * beside it is referenced, and which dropped files quikleaf can open. Pure
 * string work; the Rust side does the real file system calls.
 */

const TEXT_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx", "txt", "text", "rst", "adoc", "json", "yaml", "yml", "toml", "csv", "tsv"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif"]);

/** The extension of `path`, lower-cased, without the dot ("" when there is none). */
export function extOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The last segment of `path` (either separator). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** The folder of `path`, with the original separators; "" when it has none. */
export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? "" : path.slice(0, i);
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extOf(path));
}

/** Files quikleaf opens as a document when dropped: markdown and plain text formats. */
export function isTextDocumentPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extOf(path));
}

/** `C:\x` or `/x`: a file system path rather than a URL path. */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * True for an image `src` that names a file beside the document ("img/a.png",
 * "./a.png", "../a.png"), not a URL, a data URI, a protocol-relative URL or an
 * anchor.
 */
export function isRelativeSrc(src: string): boolean {
  const s = src.trim();
  if (!s || s.startsWith("#") || s.startsWith("//")) return false;
  if (isAbsolutePath(s)) return false;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s);
}

/** Join `dir` and a relative `rel`, resolving `.` and `..`; forward slashes in the result's relative part. */
export function joinPath(dir: string, rel: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const base = dir.split(/[\\/]/);
  const out = base.filter((seg, i) => seg !== "" || i === 0);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 1 || (out.length === 1 && out[0] !== "")) out.pop();
      continue;
    }
    out.push(seg);
  }
  const joined = out.join(sep);
  return dir.startsWith("/") && !joined.startsWith("/") ? "/" + joined : joined;
}

/**
 * `to` written relative to the folder `fromDir`, with forward slashes (the
 * markdown convention). Paths are compared as given, neither is canonicalised.
 * Two different Windows drives have no relative form, so `to` comes back as is.
 */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir.split(/[\\/]/).filter(Boolean);
  const b = to.split(/[\\/]/).filter(Boolean);
  const drive = (s: string | undefined) => (/^[a-zA-Z]:$/.test(s ?? "") ? s!.toLowerCase() : null);
  if ((drive(a[0]) || drive(b[0])) && drive(a[0]) !== drive(b[0])) return to;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ups: string[] = Array(a.length - i).fill("..");
  return [...ups, ...b.slice(i)].join("/") || ".";
}
