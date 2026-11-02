# markdown-rt — Markdown with a runtime

Draft 0.1 · 2026-11-01 · status: proposal (deftio). Lives here until it moves to the quikdown repo.

A markdown-rt document is an ordinary Markdown file. Some of its fenced code blocks carry a short
list of *pragmas* in the fence info string. A host with a runtime (quikdown_edit, quikleaf) can
address those fences by id, execute the ones marked `run` inside a sandbox, show their output, and let
them read or rewrite other fences. A host without a runtime shows plain code blocks. Nothing else
changes about Markdown.

```markdown
```csv #sales
region,q1,q2
west,120,140
east,90,160
```

```js run #summary in=sales out=summary-table
const rows = mrt.data("sales");
return rows.map(r => `| ${r.region} | ${+r.q1 + +r.q2} |`).join("\n");
```

```md #summary-table immutable
| region | total |
|---|---|
```
```

---

## 0. Naming

**Recommendation: keep `markdown-rt`.** Expand RT as **runtime**: "Markdown with a runtime." The
real-time reading also fits the watch-mode use, which is a bonus, not the definition. Short forms:

| Use | Name |
|---|---|
| Format, docs, repo tag | markdown-rt |
| Front-matter key, API global, CSS prefix, diagnostics | `mrt` |
| File extension | none — files stay `.md`. The format is a *profile* of Markdown, not a new type. |

Why not the alternatives (checked 2026-11-01):

- `rundown` — the best word (it already means "a brief report"), but taken in this exact niche: elseano/rundown runs Markdown as console scripts.
- `livemd` — Livebook's extension.
- `mdx`, `rmd`, `qmd` — taken (MDX, R Markdown, Quarto).
- `activemd` — a dead 2013 project, and `amd` collides with the module format and the CPU vendor.
- `markdown-rt` / `mrt` — no collisions found. The only neighbour is `md-editor-rt`, a React editor, unrelated.

The one real cost of "rt" is that some readers will think *rich text*. The spec's first sentence and
the README fix that; the name should not try to.

## 1. Goals and non-goals

Goals

1. **Plain Markdown first.** Every markdown-rt document is a valid CommonMark document that renders sensibly everywhere. All format-specific information lives in fence info strings and optional front matter.
2. **Source is the truth.** Execution results are ephemeral unless a cell explicitly writes them back into a fence. The file never contains hidden state, cached outputs, or a second syntax.
3. **One grammar for every fence.** The same pragmas (`#id`, `immutable`, `hidden`, …) apply to `svg`, `csv`, `mermaid`, `js run`, anything. Execution is one pragma among several, not a separate dialect.
4. **Addressable parts.** Fences can be named and referred to by scripts and by the host (outline, agents, watch mode).
5. **Deterministic, race-free updates.** A script rewriting a fence re-renders exactly that fence and re-runs exactly the cells that depend on it, in a defined order, with late results discarded.
6. **Sandboxed by construction, gated by the host.** Code runs in an isolated realm with no DOM access and no network unless the host grants it. The host, not the document, decides whether anything runs at all.

Non-goals

- Compatibility with other executable-markdown grammars. We borrow ideas, not syntax, wherever their syntax would complicate ours.
- Storing outputs in the file (Jupyter-style). Use `out=` to materialise a result into a fence when you want it saved.
- A general component system (MDX). No JSX, no imports in prose.
- Out-of-sandbox access (filesystem, shell, OS). If that is ever wanted it is a separate, host-specific capability layer with its own spec.
- Languages other than JavaScript in v1. The grammar is language-neutral; the runtime registry decides what `run` means for a given `lang`.

## 2. Terminology

- **Document** — one Markdown file, held by the host as a *document model* with a monotonically increasing `version`.
- **Fence** — a fenced code block (``` or ~~~). Its **info string** is the text after the opening marker. Its **body** is the text between the markers, without the trailing newline.
- **Pragma** — a token in the info string after the language, drawn from the reserved set in §4.3.
- **Id** — a document-unique name given to a fence with the `#name` pragma.
- **Cell** — a fence carrying the `run` pragma whose language has a registered runtime.
- **Output slot** — a DOM region owned by a cell, rendered after (or instead of) its source. Not part of the document.
- **Write-back** — a cell replacing the body of a fence through `mrt.set()` or `out=`. Part of the document.
- **Tick** — one scheduler pass: a batch of changes, the cells they dirty, and the rounds needed to settle them (§6).
- **Host** — the program embedding the runtime: quikdown_edit, quikleaf, a static page.
- **Realm** — the sandboxed JavaScript global in which a document's cells execute (one per document).

## 3. Document model

### 3.1 Front matter (optional)

```yaml
---
mrt: 1            # format version; lets future versions change meaning safely
mrt-run: manual   # document preference: off | manual | auto (default: inherit host)
---
```

Front matter is never required. A document with pragmas and no front matter is a markdown-rt
document at version 1. `mrt-run` can only lower the host's execution level, never raise it (§6.1).

### 3.2 Segments

For rendering and addressing, the host splits a document into a sequence of top-level **segments**:

- a **fence segment** for each fenced block, with its exact source range, info string, parsed pragmas and body;
- a **prose segment** for each maximal run of Markdown between fences.

Fence detection uses the same scanner quikdown core uses to render, exported as `quikdown.segments(md)`,
so the runtime and the renderer can never disagree about where a fence starts and ends. Fences inside
blockquotes or list items are not top-level segments and are not addressable in v1.

### 3.3 Ids

- Syntax: `#` followed by `name`, where `name` matches `[A-Za-z_][A-Za-z0-9_-]*`.
- Ids are unique within a document. On a duplicate, the **first** fence in document order owns the id; later ones get diagnostic `duplicate-id` and are not addressable. (First-wins keeps half-typed documents usable in watch mode.)
- Fences without an id are not addressable by cells. The host may show an ordinal for debugging; ordinals are not stable and never appear in the API.
- Headings and prose are not addressable in v1. If heading refs are added later they will be read-only (§14).

## 4. Fence grammar

### 4.1 Form

```
```lang [token token …]
```

- `lang` is the first whitespace-delimited word, exactly as every Markdown renderer already treats it. GitHub, highlighters and quikdown's own fence handlers keep working because they only read the first word.
- Tokens after `lang` are separated by whitespace. Order does not matter.
- Three token kinds: `#name` (id), `flag` (a reserved bare word), `key=value` (value bare or `"double quoted"`, with `\"` escapes).
- Unknown tokens are ignored, never an error. This is what lets other tools' info strings (`title="x"`, `showLineNumbers`) coexist, and what lets later versions add pragmas.
- The host preserves the **verbatim info string** on the rendered node (quikdown already does, in `data-qd-lang`) so bidirectional editing round-trips exactly.

Leniency (MAY): a host may accept the remainder wrapped in `{ … }` and may strip a leading `.` from a flag, so Pandoc/MPE-style ```` ```js {#chart .immutable} ```` parses the same. Two lines of parser; no other alias forms.

### 4.2 Why not `lang:pragma`

The earlier sketch was ```` ```svg:mrt-immutable ````. It has one attraction — it reaches today's quikdown fence plugin with no core change — and three costs:

1. Every renderer that keys on the first word (GitHub, highlight.js class names, quikdown's own `svg`/`csv` handlers) sees an unknown language `svg:mrt-immutable` and falls back to plain text. The "degrades to normal Markdown" promise is broken for exactly the fences we care about.
2. Pragma parsing must then live in every fence handler instead of once in core.
3. Multiple pragmas need a second separator anyway (`svg:mrt-immutable,mrt-hidden`), at which point it is a worse version of the token list.

Space-separated tokens after the language win on all three. The `mrt-` prefix is likewise unnecessary: the reserved vocabulary is tiny, other tools ignore unknown tokens, and if two runtimes ever contend for the same file the front-matter `mrt:` key is the switch, not per-token namespacing.

### 4.3 Reserved pragmas (v1)

| Pragma | Applies to | Meaning |
|---|---|---|
| `#name` | any fence | Addressable id (§3.3). |
| `run` | fence whose `lang` has a registered runtime | This fence is a cell. Without a runtime for `lang`, diagnostic `no-runtime`, rendered as code. |
| `auto` / `manual` | cell | Per-cell execution preference. Effective level = min(host, document, cell) (§6.1). |
| `in=a,b` | cell | Declared inputs. Union with observed reads (§6.3). Unknown ids → `unknown-input`. |
| `out=id` | cell | The cell's return value (if not `undefined`) is written to fence `id` as its new body, as if by `mrt.set`. |
| `timeout=ms` | cell | Overrides the host's default run timeout (§6.5). Host may clamp. |
| `immutable` | any fence | The runtime may not write this fence. `mrt.set` throws `immutable`. Users can still edit it (§9). |
| `hidden` | any fence | Preview hides the source. A cell still shows its output slot. Source mode always shows everything. |
| `collapsed` | any fence | Preview shows the source folded with a toggle. |
| `title="…"` | any fence | Caption shown above the fence / output. |

Rules: a flag given twice is one flag. `auto` and `manual` together → `manual` and diagnostic `conflicting-pragmas`. `in=` and `out=` on a non-cell are ignored with `pragma-needs-run`.

Standardisation means exactly this table: no pragma is specific to one language, and new fence types (`py run`, `wasm run`) get the whole table for free.

### 4.4 Examples

```
```svg #logo immutable hidden
```mermaid #arch title="Service map"
```csv #sales
```js run #totals in=sales out=sales-summary
```js run #draw manual timeout=20000
```md #sales-summary immutable
```

## 5. Addressing

Cells refer to fences by id only. The API (§7) takes an id string everywhere. There are no positional
refs, no section refs and no cross-document refs in v1. A watch-mode host showing several documents
gives each its own realm; they do not see each other.

## 6. Execution model

### 6.1 Policy

The host sets an execution level: `off` < `manual` < `auto`.

- `off` (default): no realm is created; cells render as code with a small "execution disabled" badge.
- `manual`: a realm exists; every cell shows Run; nothing runs on open or on change.
- `auto`: cells run on open and re-run when their inputs change.

Effective level for a cell = min(host level, document `mrt-run`, cell `auto`/`manual`). Lower layers can
only restrict. The host can change its level at runtime (`setExecutionPolicy`); lowering to `off`
destroys the realm immediately, keeps rendered outputs on screen and marks them stale.

A separate host boolean `writeBack` (default true) gates `mrt.set` and `out=`. Watch-mode and
read-only documents set it false; `set` then throws `readonly-document`, while `mrt.out` still works.

### 6.2 Cells

A cell's body is wrapped as the body of an `async` function `(mrt) => { … }` and evaluated in the
document's realm. Top-level `await` works. `const`/`let` declarations are local to the run. State that
should survive across cells or runs goes on `mrt.state` (one object per realm) or `globalThis`. The
realm is a kernel in the notebook sense: "Restart runtime" recycles it.

A run **ends** when the returned promise settles or the timeout fires. Each run has an **epoch**
token; the API handle given to the cell is bound to it (§6.6).

### 6.3 Dependencies

A cell depends on a fence if the id appears in its `in=` list **or** the cell read it (`get`, `data`,
`attrs`) during its most recent run. Observed reads make `in=` optional; `in=` remains useful as
documentation and for conditionally read inputs. Dependencies are recomputed after every run.

### 6.4 The tick

All mutations — user edits, `set` calls, file reloads, Run clicks — flow through one function on the
main thread, `applyChanges(batch)`. Because JavaScript is single-threaded, mutations are serialised by
construction. A tick is what happens after a batch:

1. **Changed set** = fences whose `rev` changed in the batch.
2. **Dirty set** = cells depending on a changed fence (at effective level `auto`), plus cells the user asked to run. A cell is never dirtied by a change it made itself in this tick (writer exclusion).
3. **Order** = topological by dependencies, document order as tiebreak. A dependency cycle among dirty cells falls back to document order with diagnostic `dependency-cycle`.
4. **Run** each dirty cell one at a time, awaiting its end. Writes apply immediately to the model (new `rev`, re-render scheduled) and are added to the *next round's* changed set.
5. **Round** = steps 2–4. Repeat while the changed set is non-empty, up to **8 rounds** per tick; then stop with `cycle-limit` on the cells still dirty.
6. Mutations arriving during a tick (the user keeps typing) are applied to the model at once — editing is never blocked — but their scheduling is deferred to the next tick.

Self-modification is therefore permitted and bounded: a cell may rewrite its own inputs or even its own body; writer exclusion stops the trivial loop, the round cap stops the mutual one, and because everything is in the sandbox the worst case is a noisy document, not a compromised host.

### 6.5 Timeouts

Default run timeout 5000 ms, overridable per cell with `timeout=` and clamped by the host. On
timeout the run ends with `timeout`; its epoch is invalidated. A busy loop cannot be interrupted in a
same-thread realm, so the host MAY recycle the realm (destroy and recreate the iframe) on timeout,
which also clears `mrt.state`. The badge says so.

### 6.6 Race rules

These are the whole of the concurrency story. Everything else follows from them.

1. **One model, one writer.** All mutations go through `applyChanges` on the main thread. The model carries `version` (document) and `rev` (per fence).
2. **Snapshot reads.** A run reads from a snapshot of fence bodies taken when it starts, updated by its own writes. Reads inside a run are therefore synchronous and consistent.
3. **Epoch-checked writes.** `set`, `out` and `print` carry the run's epoch. If the run has ended, been re-scheduled or cancelled, the write is dropped with `stale-write`. Late `fetch` callbacks cannot corrupt a newer state.
4. **Rev-checked renders.** Every asynchronous renderer (mermaid, maps, STL, MathJax, the output slot) captures the fence `rev` when it starts and checks that the node is still connected and still at that `rev` before touching the DOM. Otherwise it discards its result.
5. **Range writes, not string writes.** `set` replaces the body range of one fence inside the source. Edits elsewhere are untouched; a caret inside the replaced range moves to the end of the new body.
6. **Last writer wins** within a tick when two cells write the same fence; both writes apply in order. Authors who need protection use `immutable`.
7. **One undo step per tick.** All write-backs from one tick form one entry in the editor's undo history, so Undo reverts "what the scripts did", not one `set` at a time.

## 7. The `mrt` API

Available inside a cell as `mrt`. Reads are synchronous (snapshot, §6.6). Writes are synchronous from
the cell's point of view and applied in order by the host.

```ts
interface Mrt {
  // reading
  get(id: string): string;                 // fence body; throws not-found
  data(id: string): unknown;               // body parsed by lang: csv/tsv/psv → object[] (header row),
                                           // json → JSON.parse, yaml → parsed if host supports, else string
  attrs(id: string): FenceAttrs;           // { lang, id?, run, auto?, manual?, in: string[], out?, immutable, hidden, collapsed, title?, raw }
  ids(): string[];                         // all addressable ids in document order
  self: { id?: string; attrs: FenceAttrs };

  // writing
  set(id: string, body: string): void;     // write-back; throws not-found | immutable | readonly-document | stale-write
  out(markdown: string): void;             // replace this cell's output slot (rendered as Markdown, §8)
  print(...args: unknown[]): void;         // append one preformatted line to the output slot

  // environment
  state: Record<string, unknown>;          // persists across runs in this realm
  policy: "manual" | "auto";
  writeBack: boolean;
  version: number;                         // document version at snapshot
}
```

Return value: if a cell returns a non-`undefined` value, it is `String(value)` (objects → `JSON.stringify`,
2-space) and goes to the `out=` fence if present, else to the output slot as a Markdown code block.
`console.log/warn/error` are mirrored to a per-cell log drawer, never to the document.

Nothing in the API yields DOM nodes or host objects. The cell cannot see the page.

## 8. Outputs

- The **output slot** is a `div.mrt-out[data-mrt-for=id]` rendered after the fence (in place of it when `hidden`). It is DOM only. Saving the file saves nothing from it.
- Slot content given to `mrt.out()` is Markdown rendered by the same quikdown options as the document, with two exceptions: execution level `off` (fences in output are never cells) and `writeBack` false. A cell shows a chart by outputting a ```` ```vega-lite ```` fence; a table by outputting Markdown table syntax. Every existing fence renderer is reused; no second rendering path.
- **Write-back** (`set`, `out=`) puts text into the document. That is the only way a result reaches the file, and it is deliberate: a report that should carry its numbers when opened in a plain viewer writes them into a `#summary-table` fence; a dashboard that should always recompute does not.
- Errors: a thrown error renders in the slot as `mrt-error` with message and the first stack frame mapped to the cell line. Diagnostics (§Appendix C) render as badges on the fence.

## 9. Immutability

`immutable` is a promise to the **author** about **scripts**: no cell can rewrite this fence, including
the cell itself. It is not an editor lock; the user owns the file and may edit anything. Hosts SHOULD
show a lock badge. Typical uses: templates (`#sales-summary immutable` whose body a script may *only*
produce through `out=` — note `out=` is also refused, so remove `immutable` on fences meant as targets),
reference data, and the code cells of a document that other cells may read but must not alter.

Editor read-only-ness (watch mode, files from outside) is host policy (`writeBack:false`, read-only
source view), not a pragma, because a document should not be able to tell its reader what they may
type.

## 10. Incremental rendering (quikdown_edit)

Today the editor repaints the preview with one `innerHTML` replace per change (20 ms debounce) and then
post-processes mermaid, maps, STL and math asynchronously. That is both the performance problem and the
race problem. The replacement is segment-level rendering with keyed reconciliation:

1. **Segment** the source (§3.2). Compute a key per segment: fence → the id if present, else `h:` + hash(info + body) + `~n` for the n-th identical fence; prose → `p:` + hash(text + defsHash).
2. **Definitions pass.** Reference-link definitions, footnote definitions and heading-id allocation have document scope. Collect them in one cheap scan into a `defs` table; its hash is part of every *prose* key, never a fence key. Changing a link definition re-renders prose (cheap) and leaves every chart alone (expensive). Heading-id dedup is deterministic from the table, so ids stay stable.
3. **Reconcile** the previous segment node list against the new key list: reuse a node when its key is unchanged, render a new node otherwise, remove leftovers, reorder with `insertBefore`. Bitwrench's `syncChildren` is the same algorithm; the editor carries its own tiny copy to stay dependency-free.
4. **Tag** each fence node with `data-qd-key` and `data-qd-rev`. Async renderers obey race rule 4.
5. **Cursor and state preservation** fall out: an unchanged map keeps its pan/zoom, a 3D model its camera, the preview its scroll. That, as much as speed, is why to do this.

Editor API additions the runtime uses (and anything else can use — the agent tools in quikleaf, for
one): `getFence(id)`, `setFence(id, body, {group})`, `onFenceChange(cb)`, `segments()`. The runtime is
an ordinary consumer of these; nothing in the segment layer knows about execution.

Bidirectional mode: `data-qd-lang` already stores the full info string; the spec requires it stay
verbatim so pragmas survive a round trip through preview editing.

## 11. Security model

- **Realm** = a sandboxed `<iframe sandbox="allow-scripts">` with an opaque origin and a strict CSP. Cells run there; the host talks to it over `postMessage` with a versioned message schema. The realm has no reference to the host window, DOM or storage.
- **Network** inside the realm is off unless the host grants it; quikdown_edit maps its existing `allowExternalFetch` onto a CSP `connect-src` for the realm. Data a cell needs should be in a fence.
- **Policy is a ceiling** (§6.1): nothing in a document can raise it. Default `off`.
- **The gate covers the whole family.** `allowExecution` governs every runtime; a future `py run` registers under it rather than adding a second switch. Per-language form: `allowExecution: { js: "manual", py: false }`.
- **What the gate does not do.** A third-party `fence_plugin` that returns a `<script>` is outside quikdown's safety story today and remains so. The docs say this in one sentence so the flag is not read as a general content-security guarantee.
- **Agents.** When an LLM tool writes a document in quikleaf, the document's cells still only run at the host level the user chose. Review cards show write-backs as diffs like any other edit.

## 12. Host integration

### 12.1 quikdown core (two small, non-breaking changes)

1. `fence_plugin.render(body, info, attrs)` — the second argument stays the verbatim info string (it already is); a third argument is the parsed `FenceAttrs`. Export the parser as `quikdown.parseInfo(str)`. Fix the default renderer to emit `class="language-<lang>"` from the first word only.
2. Export `quikdown.segments(md)` — the fence scanner core already uses, returning `{kind, start, end, info, attrs, body}` per segment.

Core does not execute anything, does not know about `mrt`, and does not change output for documents without pragmas.

### 12.2 quikdown-rt (new module, shipped in quikdown_edit's standalone bundle)

The runtime: realm management, scheduler (§6), API bridge (§7), output rendering (§8), diagnostics.
Factory: `quikdownRt({ getFence, setFence, onFenceChange, segments, render, policy, writeBack })`. It is
host-agnostic; a static page can use it with a read-only provider.

### 12.3 quikdown_edit

Segment rendering (§10); options `allowExecution: false | "manual" | "auto"` and `writeBack`;
`setExecutionPolicy()`; the fence/segment API; Run / Run all / Restart runtime UI; lock, hidden,
collapsed and error badges.

### 12.4 quikleaf

Settings → Execution: level and write-back, stored with the other editor preferences and applied live.
Watch mode opens documents with `writeBack:false`. Agent tools gain `fence_get`/`fence_set` by id
(review-carded) and the outline lists fence ids alongside headings.

## 13. Comparison with other formats

Moved to `markdown-rt-comparison.md`: executable-Markdown grammars (Jupytext/MyST, knitr, Quarto,
Observable Framework, MDX, Runme, Rundown, MPE, Livebook, Docusaurus) and notebook systems compared on
style (Jupyter, Wolfram, Observable, Pluto, Marimo, Livebook, MATLAB, Maple, Hex, Zeppelin, Excel), with
the lessons taken and avoided, and a cross-vocabulary table mapping each pragma to its equivalent
elsewhere.

## 14. Open questions

1. **Python and others.** Pyodide in the same realm is feasible; the registry and gate already allow it. Not v1.
2. **Inputs/widgets.** `mrt.input()` sliders and selects would make dashboards interactive; they need a persistence story (URL? front matter? none?). Not v1.
3. **Heading and section refs.** Read-only `mrt.md("#heading-id")` would let a cell summarise a section. Cheap once `heading_ids` is on; deferred until a use case needs it.
4. **Cross-document refs in watch mode** (`other.md#id`). Tempting for multi-file reports; conflicts with one-realm-per-document. Deferred.
5. **Frozen outputs** for sharing without a runtime: `out=` is the current answer; a `freeze` pragma that materialises the slot on save may be wanted.
6. **`hidden` in source mode and bidirectional mode**: always visible in source; in preview editing the hidden source node stays in the DOM but collapsed, so round-tripping is unaffected. Confirm with the quikdown_bd implementation.
7. **Size limits** for snapshot reads (very large data fences). Likely a per-fence cap with `mrt.get` throwing `too-large` and a streaming read later.

---

## Appendix A — Info-string grammar (ABNF)

```
info-string = lang *( 1*WSP token ) *WSP
lang        = ( ALPHA / DIGIT ) *( ALPHA / DIGIT / "-" / "_" / "+" / "." / "#" )
token       = id-token / kv / flag
id-token    = "#" name
kv          = name "=" value
flag        = name
name        = ALPHA *( ALPHA / DIGIT / "_" / "-" )
value       = bare / quoted
bare        = 1*( VCHAR except WSP / DQUOTE )
quoted      = DQUOTE *( qchar / "\" DQUOTE / "\" "\" ) DQUOTE
qchar       = VCHAR except DQUOTE / "\"  ;  also SP
```

`lang` may not begin with `#`. Lists in `in=` are comma-separated names with no spaces unless quoted.
Unknown flags and keys are ignored. Optional leniency: strip one outer `{ }` around the token list;
strip a leading `.` from a flag.

## Appendix B — Worked examples

**Live report (watch mode).** An agent appends rows to `#runs`; the viewer re-renders the chart and the
summary only. `writeBack` is false, so the agent's file is never modified by the viewer.

```markdown
```csv #runs
ts,test,ms,ok
2026-11-01T10:00:01Z,unit,812,true
```

```js run #chart in=runs hidden
const rows = mrt.data("runs");
mrt.out("```vega-lite\n" + JSON.stringify({
  mark: "line", data: { values: rows },
  encoding: { x: { field: "ts", type: "temporal" }, y: { field: "ms", type: "quantitative" } }
}) + "\n```");
```

```js run #status in=runs hidden
const rows = mrt.data("runs");
const bad = rows.filter(r => r.ok !== "true").length;
mrt.out(bad ? `**${bad} failing**` : "All passing");
```
```

**Self-modifying document (editor, `auto`, write-back on).** The first cell rewrites a fence that the
second cell depends on; writer exclusion keeps the first from re-running itself.

```markdown
```json #config
{ "n": 5 }
```

```js run #bump in=config
const c = JSON.parse(mrt.get("config"));
if (c.n < 10) mrt.set("config", JSON.stringify({ n: c.n + 1 }, null, 2));
```

```js run #show in=config
return "n is now " + JSON.parse(mrt.get("config")).n;
```
```

`#bump` runs, writes `#config` (round 1). Round 2: `#show` is dirty and re-runs; `#bump` is not, because
it was the writer. If the user edits `#config` by hand, both run again. Had `#bump` depended on a fence
that `#show` writes, the two would alternate until the round cap (8) and stop with `cycle-limit`.

## Appendix C — Diagnostics

Rendered as badges on the fence; also surfaced in the host's log.

| Code | Meaning |
|---|---|
| `duplicate-id` | A later fence reuses an id; it is not addressable. |
| `no-runtime` | `run` on a language with no registered runtime. |
| `unknown-input` | `in=` names an id that does not exist. |
| `pragma-needs-run` | `in=`/`out=`/`timeout=`/`auto`/`manual` on a non-cell. |
| `conflicting-pragmas` | `auto` and `manual` together; `manual` wins. |
| `dependency-cycle` | Dirty cells form a dependency cycle; document order used. |
| `cycle-limit` | A tick exceeded 8 rounds; remaining cells left dirty. |
| `timeout` | Run exceeded its timeout; epoch invalidated. |
| `stale-write` | A write arrived after the run ended or was superseded; dropped. |
| `immutable` | `set` targeted an immutable fence. |
| `readonly-document` | `set` while host `writeBack` is false. |
| `not-found` | API call named an id that does not exist. |
| `execution-disabled` | Cell present but host level is `off`. |
